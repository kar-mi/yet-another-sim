# FFXIV Raid Mechanics Simulator — Build Plan

> Working draft. Edit and refine freely.

## Context

Greenfield project. Goal: a browser-based simulator for practicing FFXIV-style raid mechanics. Eventually supports live multiplayer and user-authored raids, with 3D graphics that can be upgraded over time.

Confirmed decisions:
- **Runtime/tooling:** Bun (1.3.13 installed). Bun bundles the client and will host the server.
- **Multiplayer:** Build a single-player vertical slice now, but architect for server-authoritative netcode so multiplayer drops in additively later.
- **Rendering:** Babylon.js, simple primitives, hidden behind a `Renderer` interface so it can be swapped/upgraded.
- **Camera/controls:** FFXIV-style orbit camera (mouse) + WASD movement relative to camera.
- **Raid authoring:** Raids are JSON timeline files (data, not code), validated at load.
- **MVP deliverable:** Load a sample raid JSON, play it solo from start to finish, dodge several mechanics, and report pass/fail at the end.

The central design principle: **the simulation engine is a pure, deterministic, render-agnostic module driven by a fixed-timestep tick loop, where player control is expressed as a serializable "intent" per tick.** This is what makes the single-player core netcode-ready — the same engine runs on the server later, and intents are what travel over the wire.

## Tech Stack & Dependencies

- `bun` — runtime, bundler, dev server, (later) WebSocket server.
- `@babylonjs/core` — 3D rendering (client only).
- `zod` — validate user-authored raid JSON at the trust boundary, with friendly errors. (Only runtime dep besides Babylon.)
- TypeScript throughout.

## Project Structure

```
package.json            # scripts: dev, build, typecheck
tsconfig.json
index.html              # canvas + bundled entry (Bun HTML entrypoint)
raids/
  sample-raid.json      # the MVP sample timeline
src/
  shared/
    math.ts             # Vec2 (ground plane x/z), helpers
    types.ts            # World, Player, ActiveMechanic, Intent, shared enums
  engine/               # PURE sim — no DOM, no Babylon, no Bun APIs
    world.ts            # create/serialize world state
    sim.ts              # tick(world, intents, dt) -> world  (deterministic)
    shapes.ts           # AOE shape defs + point-in-shape hit tests
    timeline.ts         # schedules raid events into active mechanics
    raidSchema.ts       # zod schema + types for raid JSON
    raidLoader.ts       # parse/validate JSON -> typed Raid
    result.ts           # pass/fail + per-mechanic hit log
  client/
    main.ts             # bootstrap: load raid, build world, start loop
    loop.ts             # fixed-timestep accumulator + render interpolation
    input.ts            # keyboard -> Intent (move vector in camera space)
    render/
      Renderer.ts       # interface: init(world), sync(world, alpha), dispose()
      BabylonRenderer.ts# Babylon implementation
  server/
    server.ts           # Bun.serve: static + bundled client; WS endpoint STUB
```

## Engine Design (the core)

**State (`shared/types.ts`):**
- `World`: `{ time, status, arena: Arena, players[], active[], pending[], log[] }`
- `Arena`: `{ zones: ZoneShape[] }` — walkable floor is the **union** of all zones; gaps are implied by the absence of any zone at a position.
- `ZoneShape`: discriminated union — `{ kind: "circle", center, radius }` | `{ kind: "rect", center, width, height }` | `{ kind: "polygon", vertices: Vec2[] }`
- `Player`: `{ id, role, pos: Vec2, facing, hp, alive }`
- `ActiveMechanic`: resolved shape + `telegraphStart`, `resolveAt`, `damage`, `resolved`
- `Intent`: `{ move: Vec2 }` (normalized direction in world space; serializable — the unit of network input)

**Tick (`engine/sim.ts`) — `tick(world, intents, dt)`:**
1. advance `world.time += dt`
2. apply each player's `Intent.move` scaled by speed; check if new position is inside any `arena.zone` (`isOnFloor(pos, arena)`). If yes, commit the move. If no, the player falls — set `hp = 0`, mark dead, append `"fell"` to log. No position clamping: walking off the edge is a valid (fatal) outcome.
3. promote `pending` timeline events whose `t <= time` into `active` (telegraph begins)
4. for each `active` mechanic past `resolveAt`: snapshot player positions, run hit test (FFXIV snapshot-at-resolve semantics), subtract damage from players inside, append to `log`, mark resolved/expire
5. recompute `status`: `running` → `cleared` (time past duration, all resolved, ≥1 alive) or `wiped` (all dead)

Deterministic: no `Math.random`, no wall-clock, no frame-rate coupling. Same inputs → same output.

**Shapes (`engine/shapes.ts`)** — hit tests on the ground plane (x/z): `circle`, `donut`, `cone`, `rect/line`. Covers the common FFXIV telegraph vocabulary; more can be added without touching the loop.

## Raid JSON Schema (`raids/sample-raid.json`)

```jsonc
{
  "name": "Sample Raid",
  "arena": { "zones": [{ "kind": "circle", "center": [0,0], "radius": 20 }] },
  "duration": 45,
  "players": [{ "id": "p1", "role": "dps", "spawn": [0, 8] }],
  "events": [
    { "t": 4,  "name": "Fireball",   "telegraph": 3, "damage": 60,
      "shape": { "kind": "circle", "center": [0,0], "radius": 9 } },
    { "t": 11, "name": "Cleave",     "telegraph": 3, "damage": 60,
      "shape": { "kind": "cone", "origin": [0,0], "direction": [0,1], "angleDeg": 90, "length": 22 } },
    { "t": 18, "name": "Crossfire",  "telegraph": 4, "damage": 80,
      "shape": { "kind": "rect", "origin": [0,0], "direction": [1,0], "width": 6, "length": 40 } },
    { "t": 26, "name": "Shockwave",  "telegraph": 4, "damage": 100,
      "shape": { "kind": "donut", "center": [0,0], "inner": 7, "outer": 30 } }
  ]
}
```

Validated by `raidSchema.ts` (zod) in `raidLoader.ts`; invalid files produce a readable error rather than a crash. Each event becomes a `pending` mechanic; telegraph window = `[t, t+telegraph]`, resolves at `t+telegraph`.

## Renderer (Babylon, swappable)

`Renderer` interface keeps the engine ignorant of Babylon:
- `init(world)` — engine + scene, one ground mesh per `arena.zone` (so gaps are visually open voids), one mesh per player (capsule), `ArcRotateCamera` (orbit/zoom via mouse) targeting the player.
- `sync(world, alpha)` — each frame: move player meshes (interpolated by `alpha`), draw/refresh AOE telegraphs as flat semi-transparent ground meshes whose color intensifies as `resolveAt` approaches, then flash/clear on resolve. HUD text: raid time + result.
- `dispose()` — teardown.

Simple primitives only; richer models/VFX are a later drop-in behind this same interface.

## Input + Game Loop (netcode-ready)

- `input.ts`: WASD → a movement vector, rotated by camera yaw → normalized `Intent.move`. This intent object is exactly what a client would send to the server later.
- `loop.ts`: `requestAnimationFrame` with a **fixed-timestep accumulator** at 60 Hz (`dt = 1/60`): `while (acc >= dt) { world = tick(world, {p1: currentIntent}, dt); acc -= dt }`, then `renderer.sync(world, acc/dt)` for smooth interpolation. Decoupling sim ticks from render frames is the foundation netcode builds on.

## Netcode-Ready Seams (designed now, not implemented)

- Engine is pure/deterministic and imports nothing client-specific → server can run the identical `tick`.
- `Intent` and `World` are JSON-serializable → ready to send over WS.
- `server/server.ts` ships a **stub** WebSocket endpoint alongside static serving, so adding authoritative simulation + broadcast later is additive, not a rewrite.
- `players[]` is already a list (not a hardcoded single player), so adding more controllers is data, not structure.

## Build / Run Setup

- `index.html` imports `src/client/main.ts`; Bun bundles it automatically (Bun HTML entrypoint).
- `package.json` scripts:
  - `dev` → `bun server/server.ts` (serves bundled client + WS stub, hot reload)
  - `build` → `bun build ./index.html --outdir dist`
  - `typecheck` → `bunx tsc --noEmit`
  - `test` → `bun test` (determinism + schema validation tests in `src/engine/__tests__/`)
- `bun add @babylonjs/core zod`

## Verification

1. `bun run typecheck` passes.
2. `bun run dev`, open the browser: arena + player render in 3D, orbit camera works, WASD moves the character relative to camera.
3. Play through `sample-raid.json`: each mechanic shows a telegraph, then resolves; standing inside at resolve subtracts HP (visible in HUD), standing clear does not.
4. Survive all four → HUD shows **CLEARED**; deliberately stand in mechanics until HP hits 0 → **WIPED**. Confirms pass/fail.
5. Determinism check: feed a fixed scripted intent sequence to `tick` in a small script (or test) and confirm identical final `World` across runs — proves the engine is netcode-ready.
6. Validation check: load a malformed raid JSON → friendly validation error, no crash.

## Out of Scope (this iteration)

- Live multiplayer networking (only the stub + seams).
- Combat/jobs/rotations, enmity, healing — mechanics dodging only.
- Player-relative/targeted mechanics, tethers, knockbacks, tower/stack counts (shape vocabulary is extensible; MVP uses static-geometry AOEs).
- Asset-quality 3D models, animations, VFX.
- Raid authoring UI (raids are hand-written/edited JSON for now).

## Resolved Decisions

- **Tick rate: 60 Hz** (`dt = 1/60`). Cheap for a pure sim, matches the render loop target, and gives tight mechanic timing. Player move speed: ~8 units/sec (tunable constant in `engine/sim.ts`).
- **Arena: zone list with gap support.** Arena is `{ zones: ZoneShape[] }` — the walkable floor is the union of all zones. Zones are a discriminated union: `circle`, `rect`, `polygon`. There is no boundary clamping: if a player's new position falls outside every zone, they fall (instant death, logged as `"fell"`). Single-zone arenas (`[{ kind: "circle", ... }]`) cover the simple case; multi-zone arenas model platforms and gap mechanics. `isOnFloor` in `engine/shapes.ts` reuses the same hit-test infrastructure as AOE mechanics.
- **HP/damage model.** Players have `hp` (max 100) and mechanics subtract numeric `damage`. Pass/fail is derived: wiped when all `hp <= 0`. This is already reflected in the schema and tick design above.
- **Minimal test runner: yes.** Add a `bun test` script with a single determinism test: run a fixed scripted intent sequence through `tick` twice, assert bitwise-identical final `World`. Lives in `src/engine/__tests__/sim.test.ts`. Add `"test": "bun test"` to `package.json`.
