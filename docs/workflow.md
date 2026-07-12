# Development Workflow

This document describes how to develop, test, build, and deploy **Yet Another Sim** — a
server-relayed deterministic FFXIV-style raid simulator built on [Bun](https://bun.sh/) and
[Babylon.js 9](https://www.babylonjs.com/).

If you only want to author encounters (not change code), start with
[Authoring Raids](authoring-raids.md) instead.

## Prerequisites

- [Bun](https://bun.sh/) (the runtime, package manager, bundler, and test runner — no Node toolchain needed).
- For deployment only: Docker + Docker Compose.

Bun is the single toolchain here. `package.json` has no separate bundler, test framework, or
TypeScript build step — `bun build`, `bun test`, and Bun's built-in TypeScript handling cover all
of it.

## Local setup

```sh
bun install        # install dependencies (uses bun.lock)
bun run dev        # build the client bundle, then start the server
```

Then open <http://localhost:3000>. Create or join a session, claim a player slot in the lobby, and
press play.

## Day-to-day loop

| Command            | What it does |
|--------------------|--------------|
| `bun run dev`      | Runs `src/server/server.ts` with `BUILD_ON_START=1`, building the client bundle before serving it. |
| `bun run typecheck`| `bunx tsc --noEmit` — strict type checking across `src/**` and `scripts/**`. |
| `bun test`         | Runs the engine + server test suites (`*.test.ts`). |
| `bun run build`    | Produces a standalone client bundle in `.bundle/` (the production path). |
| `bun run start`    | Runs `src/server/server.ts` and serves the prebuilt `.bundle/`. |

A typical change cycle:

1. Edit code under `src/`.
2. `bun run typecheck` — the project is `strict`, so this catches most issues before runtime.
3. `bun test` — especially for anything touching `src/engine/` (see *Determinism* below).
4. Reload the browser to see client/render changes.

### Development reloads

`bun run dev` builds the client once at server startup; reload the browser after client changes.
`src/client/main.ts` registers an `import.meta.hot?.dispose(...)` cleanup hook for environments that
provide client-module HMR, but running `bun --hot src/server/server.ts` alone does not rebuild the
browser bundle or establish a client HMR pipeline.

## Project layout

The codebase is split into four layers by trust boundary and runtime:

```
src/
  shared/   # types, protocol (zod), deterministic math, RNG, constants — imported by both sides
  engine/   # the pure deterministic simulation (tick), mechanic systems, raid loading/schema
  server/   # Colyseus host: rooms, frame relay, WebSocket transport, metrics
  client/   # browser: Babylon renderer, input, netcode, prediction, UI
raids/      # YAML-authored encounters, grouped by category folder
docs/       # this folder
```

`@shared/*` is a TypeScript path alias (see `tsconfig.json`) resolving to `src/shared/*`. The
**engine runs on both the server and every client** — that shared execution is the heart of the
networking model below.

## How a session works (the data flow)

This project uses **server-relayed deterministic lockstep**. Understanding this is essential before
touching the engine, netcode, or server.

1. **Join / lobby.** `ColyseusTransport` joins or creates the filtered `relay` room hosted by
   `src/server/server.ts`. `RelayServerRoom` owns the Colyseus lifecycle, authentication, rate
   limiting, and boundary validation; it delegates session behavior to the transport-independent
   `RelayRoom`. Players claim slots; one client is the host.
2. **Start.** The server builds a tick-0 `World` from the raid definition and sends it to clients
   in a `started` message, alongside the input log so far.
3. **The relay.** The server does **not** run the simulation. `FrameRelay` produces one `Frame` per
   tick at 60 Hz — each frame is just the merged player *intents* for that tick (plus a couple of
   flags). It broadcasts these frames and keeps an authoritative input log.
4. **Client stepping.** Each client runs `tick()` (`src/engine/sim.ts`) locally, feeding it the
   relayed intents plus locally-computed bot intents. Because every client starts from the same
   seed and applies the same frames in the same order, every client computes a **byte-identical
   world** — no world state is streamed during play.
5. **Late join / reconnect / resync.** A joining client replays the input log (optionally from a
   host snapshot taken every `SNAPSHOT_INTERVAL` ticks) to fast-forward to the room's current tick.
6. **Desync detection.** Clients periodically send a `worldHash` (`HASH_INTERVAL` ticks); the server
   compares them via `DesyncTracker` and resyncs any client that diverged.
7. **Rendering.** `NetClient` coordinates a `RenderSnapshotBuffer`, which keeps a small snapshot
   history and interpolates with a fixed render delay for smoothness. The local player is additionally
   client-predicted (`src/client/predictor.ts`) so their own movement feels instant — this is
   render-only and never feeds back into the authoritative world.

```
host + clients          server (Colyseus)             every client
  intents  ───────────►  RelayServerRoom / RelayRoom / FrameRelay
                          merges intents → Frame
                          broadcasts frames  ─────────►  tick() locally → identical World
                          keeps input log                 ├─ interpolate + render (Babylon)
  worldHash ──────────►  DesyncTracker                     └─ predict local player (render-only)
                          resync if diverged ────────────►  replay input log
```

## Determinism: the rule that governs engine changes

Lockstep only works if `tick()` is a **pure, deterministic function of (world, intents, dt)** that
produces identical results on V8, JavaScriptCore, and SpiderMonkey. When editing anything under
`src/engine/`, respect these invariants:

- **No raw transcendentals.** `Math.sin/cos/atan2/acos` are *not* required to be bit-identical
  across JS engines. Use the polynomial approximations in `src/shared/dmath.ts` instead. There is a
  test guarding this (`__tests__/noTranscendentals.test.ts`).
- **Don't reorder systems.** The mechanic systems resolve in a fixed order
  (`src/engine/mechanicRegistry.ts`) because the seeded PRNG (`src/shared/rng.ts`) is drawn in
  sequence. Reordering changes RNG outcomes and breaks reproducibility.
- **No wall-clock, no `Math.random()`, no ambient I/O** inside the tick. All randomness flows
  through the seeded RNG carried in the world state.
- **Keep it serializable.** World state is JSON-relayed and hashed; avoid non-serializable fields in
  the authoritative world (render-only data is attached via a symbol key and excluded from hashing).

The `determinism.test.ts` and `worldHash` machinery exist to catch violations — run `bun test`
after any engine change.

## Testing workflow

- Tests live next to the engine in `src/engine/__tests__/` and beside server modules
  (`*.test.ts`), and run with Bun's built-in runner: `bun test`.
- The engine is pure, so most tests construct a world, step `tick()` a known number of times, and
  assert on the result — fast and deterministic, no mocks or network.
- Add a focused test for any new mechanic system, and prefer asserting on the resulting world over
  internal state.
- Run a single file with `bun test src/engine/__tests__/towers.test.ts`.

## Building & deployment

### Production bundle

`bun run build` writes the browser bundle to `.bundle/`. In production the Docker image builds this
once, so each worker only serves the prebuilt bundle.

### Container

The app ships as a Docker image (`Dockerfile`, based on `oven/bun:1`). The tracked
`docker-compose.yml` is the local single-worker stack.

- **Windows / local:** create `.env` from `.env.example`, set `METRICS_TOKEN` (the tracked Compose
  file requires it even though the application can disable metrics by leaving it unset), then
  `docker compose up -d --build`.
- **Linux server:** `./deploy.sh [branch]` — fetches, hard-resets to `origin/<branch>`, then runs
  the gitignored server compose file.

Configuration is environment-driven (see `.env.example`):

| Var             | Purpose |
|-----------------|---------|
| `PORT`          | Local single-worker HTTP/WS port (default 3000). |
| `MAX_SESSIONS`  | Local single-worker room cap. |
| `METRICS_TOKEN` | Guards the Prometheus endpoint; unset disables it outside tracked Compose. |
| `METRICS_PORT`  | Local single-worker metrics port (default 9100). |
| `MAX_CONNECTIONS_PER_IP` | Concurrent WebSocket connection cap per client IP. |
| `MAX_WS_MSGS_PER_SEC` | Inbound message rate cap per connection. |
| `ALLOWED_ORIGINS` | Additional comma-separated browser origins allowed to connect. |
| `LOG_LEVEL` | Server logging verbosity. |
| `OTEL_*` | Optional OpenTelemetry tracing; see `.env.example`. |

### Observability

The server emits Prometheus metrics (`src/server/metrics.ts`, served by `metricsServer.ts`).
Per-session replay logs are written to
`logs/sessions/*.jsonl` (a tick-0 world header plus every frame batch), so any pull can be replayed
offline. This directory grows continuously — rotate it host-side.

The header carries a replay format version independent of the application package version.
Unversioned or incompatible files remain visible in the replay list but are rejected explicitly
rather than being interpreted as the current `World`/`Frame` shape.

## Conventions

- **Babylon.js imports must be sub-path / tree-shakeable.** Import from specific module paths
  (e.g. `@babylonjs/core/Cameras/arcRotateCamera`) rather than the barrel `@babylonjs/core`, and
  never mix ES6 (`@babylonjs/*`) and legacy (`babylonjs`) packages.
- **The build keeps Babylon's side-effect registrations via `ignoreDCEAnnotations`.** Babylon wires
  engine extensions (alpha blending, texture loading, render targets…), scene-loader plugins
  (glTF), and material shaders through side-effect modules that `@babylonjs/core` marks as
  tree-shakeable. Bun's dead-code elimination would otherwise strip the ones it can't see
  referenced — and *how much* it strips varies by Bun version, so a build can silently lose
  rendering in one environment but not another (no player models, opaque "transparent" materials).
  Both build paths (`BUILD_ON_START=1` in `src/server/server.ts` and the `build` script) set
  `ignoreDCEAnnotations: true` / `--ignore-dce-annotations`, which keeps every side-effect
  registration while still eliminating genuinely-unreachable code (~2% larger bundle). **This is the
  single switch that avoids per-feature registration whack-a-mole** — prefer it over patching each
  case. As defense-in-depth (and so a plain `bun build` without the flag still renders), the engine
  extensions are *also* registered explicitly via `RegisterFullEngineExtensions()` at the top of
  `src/client/render/BabylonRenderer.ts`.
- **Render layers own their meshes.** Each visual family is a `*Layer` class with `sync()` /
  `dispose()`; `BabylonRenderer` composes them and is the only place that creates/disposes the
  engine, scene, and camera. Always dispose what you create.
- **Validate at the boundary.** All client→server messages and raid files are validated with zod
  before reaching trusted code.
- **Prefer the existing platform APIs:** Colyseus for rooms/transport and Bun-native APIs such as
  `Bun.build`, `Bun.file`, `Bun.Glob`, and `Bun.env`.

## Reference docs

- [Authoring Raids](authoring-raids.md)
- [Authoring Bot Patterns](authoring-bot-patterns.md)
- [Movement & Scale](movement-and-scale.md)
- [Finding Debuffs](finding_debuffs.md)
</content>
</invoke>
