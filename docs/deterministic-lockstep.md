# Deterministic Lockstep

How this project keeps every client's simulation byte-identical without the server
ever running the engine.

## The model

This is a **server-relayed deterministic lockstep** netcode:

- The **server never runs the simulation.** It owns lobby state and an authoritative
  **input log** — one merged-intent `Frame` per tick — and relays those frames to
  every client.
- **Every client runs the engine** (`tick()`) locally, stepping the same tick-0
  world with the same input frames in the same order. Given identical inputs, every
  client computes a byte-identical world.
- The only nondeterminism in a pull is the **per-pull seed**, minted once and shared
  with every client in the initial world.

Because the simulation is a pure function of `(seed, inputs)`, the server only has to
distribute inputs. It never sends world state on the hot path — just the tiny frames.

```
        ┌────────────┐   intents    ┌─────────────────────────────┐
 client │ input/RAF  │ ───────────► │ RelayRoom (authoritative     │
        │ prediction │              │   input log, no engine)      │
        └────────────┘ ◄─────────── │   FrameRelay: 60Hz tick loop │
              ▲          frames      └─────────────────────────────┘
              │  (one merged Frame per tick, broadcast to all)
        ┌─────┴───────────────────────────────┐
        │ tick(world, intents, dt)  ← engine   │  runs identically on
        │ deterministic, seeded PRNG threaded  │  every client
        └──────────────────────────────────────┘
```

## Why every client converges

Three properties together guarantee that two clients fed the same frames end up with
the same world hash:

1. **All simulation state lives in `World`.** A late joiner / resync rebuilds the
   world purely by replaying the input log onto a tick-0 (or snapshot) world — there
   is no hidden state in closures, module globals, or the renderer. The determinism
   test proves this by JSON round-tripping the world mid-run and confirming the hash
   stream is unchanged (`src/engine/__tests__/determinism.test.ts`).

2. **The engine only uses correctly-rounded float operations.** See *Deterministic
   math* below.

3. **The seeded PRNG is threaded through `World` and drawn in a fixed order.** See
   *RNG and system order* below.

## Deterministic math (`src/shared/dmath.ts`)

JS engines (V8, SpiderMonkey, JSC) are **not** required to agree bit-for-bit on
`Math.sin`/`cos`/`atan2`/`acos`/`pow`/`exp`/`log` — they are implementation-defined.
For byte-identical worlds across clients, the engine may only use the IEEE-754
operations that the spec mandates to be **correctly rounded**: `+`, `-`, `*`, `/`,
comparisons, and `Math.sqrt`/`floor`/`abs`.

`dmath.ts` rebuilds the transcendentals the sim needs (`sin`, `cos`, `atan`, `atan2`,
`acos`) from *only* those primitives, using polynomial (Taylor-series) approximations
with argument reduction. Accuracy is ~1e-9 — far beyond gameplay needs; the property
that matters is **cross-engine reproducibility**, not precision.

This is enforced by a guard-rail test, `noTranscendentals.test.ts`, which greps
`src/engine` and `src/shared` for banned calls:

```
Math.sin | cos | tan | atan2 | atan | asin | acos | pow | exp | log | hypot | random
Date.now
```

`Date.now` is banned in the engine because it is wall clock, not simulation state.
Only `dmath.ts`, `rng.ts`, and `logger.ts` are exempt.

## RNG and system order (`src/shared/rng.ts`, `src/engine/systems/context.ts`)

The PRNG is a tiny **mulberry32** generator built from integer ops (`Math.imul`,
shifts, xor), so it produces identical output on every engine:

- `makeSeed()` mints a fresh 32-bit seed for a new pull (the *only* nondeterministic
  call, made once on the server and shared with all clients).
- `nextRandom(state)` / `randomInt(state, n)` are pure: they take a state and return
  `{ value, state }`. No global mutable state.

The current state lives in `world.rngState`. Each tick, `createTickContext` copies it
into the `TickContext` and exposes `randFloat()` / `randInt(n)` closures that **advance
the shared `rngState` in place**. After all systems run, the orchestrator writes the
final state back into the next world (`next.rngState = ctx.rngState`).

**The order systems run in is load-bearing.** Every `randFloat`/`randInt` call advances
the same state, so reordering systems changes which mechanic draws which value and
breaks reproducibility. `sim.ts` runs the per-mechanic systems in a fixed `REGISTRY`
order, and both `sim.ts` and `context.ts` carry explicit "do not reorder" warnings.

## The tick (`src/engine/sim.ts`)

`tick(world, intents, dt)` is a pure function. It:

1. Clones the incoming world into a `TickContext` (`createTickContext`) — players,
   bosses, log, group choices, and `rngState` are all copied so the input world is
   never mutated.
2. Runs systems in fixed order: player movement → boss targeting/facing → the
   `REGISTRY` resolve loop (each mechanic family in a fixed slot) → status effects.
3. Assembles a fresh `World` snapshot, settling ctx-derived fields (`rngState`,
   `groupChoices`, `log`, `forcedMarches`, …) only after every system has run.
4. Derives status (`running` → `wiped` / `cleared`).

`dt` is the fixed timestep `1/60`. The same world stepped with the same intents always
yields the same output world.

## World hash & desync detection

`worldHash(world)` (`src/shared/worldHash.ts`) is an **FNV-1a 32-bit** hash over
`JSON.stringify(world)` with `log` excluded (render-only event history, not simulated
state). FNV-1a is pure integer math, so it is identical on every engine. Key order in
`JSON.stringify` is stable because every client builds objects in the same order.

Clients report their hash on **fixed tick boundaries** (`HASH_INTERVAL = 300` ticks in
`src/client/net.ts`) so every client hashes the *same* ticks and the server can compare
them.

The server's `DesyncTracker` (`src/server/desyncTracker.ts`) treats the **host's** hash
as canonical for a tick (the host has end-of-pull authority). Any other client reporting
a different hash for that tick has diverged and is **resynced** — the server replays the
input log (from the latest snapshot) to that one client. The tracker bounds its per-tick
hash window and rate-caps reports so a client can't spam the relay.

## Server side: input log & frame relay

- **`RelayRoom`** (`src/server/relayRoom.ts`) owns lobby/slot state and the
  authoritative tick-0 `World`. It never calls `tick()`. Each tick it merges every
  owned slot's latest intent into one `Frame` (move + facing carry forward; one-shot
  actions like jump/sprint fire once) via `buildFrame()`.
- **`FrameRelay`** (`src/server/frameRelay.ts`) drives the wall-clock 60Hz tick loop,
  appends each frame to `inputLog`, batches, and flushes to clients. A **shared
  scheduler** (one `setInterval` polling every 5ms) runs all active relays so N rooms
  don't spawn N timers.
- The loop **never drops sim time**: it processes every tick due since the last poll
  (bounded only by a `MAX_CATCHUP_SECONDS` clamp for pathological gaps like a debugger
  pause). Dropping ticks would make the authoritative position lag real input and never
  reconcile against client prediction.
- `inputLog.length` *is* the current tick. On late join / resync the log is replayed
  to rebuild the world. Snapshots (host sends one every `SNAPSHOT_INTERVAL = 600`
  ticks) bound how much tail must be replayed.

## Client side: stepping, snapshots & prediction

`NetClient` (`src/client/net.ts`):

- **`stepOne(frame)`** runs one deterministic engine step. Control is derived from the
  frame's intent keys (a slot is human exactly when it has an intent that tick) so every
  client's `computeBotIntents` is identical. It advances `appliedTick` even on a terminal
  world so the local tick stays in lockstep with the server's frame count.
- **`applyStarted`** adopts the pull's world at `baseTick` (tick 0 or a snapshot) and
  fast-forwards by replaying the tail frames, landing exactly where the rest of the room
  is.
- **Snapshot buffer + interpolation**: incoming ticks are placed on a *deterministic*
  tick timeline (`t = base + tick*TICK_MS`) so bursty/jittery delivery doesn't collapse
  interpolation into instant skips. The render view interpolates between snapshots at a
  render-delay behind the latest tick.

### Client prediction is render-only

`LocalPredictor` (`src/client/predictor.ts`) integrates the **local** player's own input
immediately so movement feels instant despite the input round-trip + render delay. This
is **strictly render-only**:

- It never touches the authoritative world, `worldHash`, or desync detection — those stay
  server-tick authoritative.
- Because the authoritative path is the *same* function of the same inputs, it converges
  to the predicted position on its own (RTT-late) with no steady drift. The only
  correction is a hard snap when divergence exceeds `SNAP_THRESHOLD` (teleport, forced
  march, respawn).

## Tests that lock this in

| Test | Guarantee |
|------|-----------|
| `__tests__/determinism.test.ts` — "engine replay is bit-identical across runs" | Same seed + inputs → identical hash stream. |
| same file — "mid-run JSON round-trip leaves the simulation unchanged" | All state lives in `World` (no hidden state). |
| same file — "snapshot-anchored join matches full replay" | A joiner adopting a snapshot at tick 600 and replaying the tail matches a full replay. |
| same file — per-mechanic `deterministic: …` cases | Human input, chains, plant-rng solver, limit-cut, knockback all stay byte-identical. |
| `__tests__/noTranscendentals.test.ts` | Engine + shared use only correctly-rounded float ops. |

## Adding new mechanics without breaking determinism

- Use `dmath` (never `Math.sin`/`cos`/`atan2`/…) and never `Date.now` in engine code.
- Draw randomness only via `ctx.randFloat()` / `ctx.randInt()`, never `Math.random()`.
- Don't reorder systems in `sim.ts` or the `REGISTRY` — RNG draw order is part of the
  contract.
- Put *all* state in `World`. If a value must survive a tick, it lives in the world
  snapshot, not a closure or module global.
- Add a case to `determinism.test.ts` if the mechanic introduces a new RNG or
  input-driven path.
</content>
</invoke>
