# Code Invariants & Workarounds

The source carries no comments. Rules that are not obvious from the code, and the reasons behind
workarounds, are collected here instead. Each entry names the file or symbol it guards. The
lockstep model itself is described in [Deterministic Lockstep](deterministic-lockstep.md).

## Engine

### Tick structure (`src/engine/sim.ts`, `src/engine/systems/context.ts`)

- **Replace, never mutate, nested player fields.** `createTickContext` clones players shallowly
  (`{ ...p }`); `pos`, `effects`, `knockbackVelocity` and `shape` still alias the previous
  snapshot, which clients keep for rendering and hashing. Assign new objects instead.
  `determinism.test.ts` deep-freezes every world across a fight to catch violations.
- `ctx.randInt`/`ctx.randFloat` are closures over `ctx`, so passing them to helpers (for example
  `effectsForMechanic`) still advances the shared `rngState`.
- `resolveForcedMarches` stores the active list on `ctx.forcedMarches`; `applyStatusEffects` later
  appends plant traps to it (those are not culled until the next tick). `tick` reads the list back
  from `ctx` only after status effects run.
- Towers push `{ labels, playerIds }` to `ctx.resolvedTowers` when a resolver consumed a charge;
  the `reassign` system, later in the same tick, re-balances charges from it.
- Resolvers read pending/active lists from `ctx.world` (the incoming snapshot), so `tick` can
  merge each module's returned slice into `next` incrementally.
- Boss facing snaps to its target every tick; smoothing is render-side only.
- `hasMechanics` counts array collections only. A raid whose only events are `effect_resolver`
  (a lookup table) therefore never clears.

### Mechanic registry (`src/engine/mechanicRegistry.ts`)

- `MODULE_FOR_TYPE` `satisfies Record<EventType, …>`, so a new event type in the schema that is
  not registered is a type error.
- Every owning module must also appear in `REGISTRY`; a module missing there would never resolve.
  The registry checks this when it loads.
- `REGISTRY` order is the RNG draw order. `heal` draws nothing and sits first so a full-raid heal
  lands before same-tick damage; `effect_resolver` has no `resolve` and may sit anywhere.

### Pre-roll (`src/engine/preRoll.ts`)

- Every roll consumes all of its RNG draws even when a choice is pinned or forced, so pinning one
  outcome leaves every later roll unchanged.

### Damage (`src/engine/systems/helpers.ts`, `damageLog.ts`)

- Vulnerability debuffs multiply a hit and are consumed only when the base damage is above 0.
- `applyMechanicDamage` respects invincibility. Explicitly lethal punishments still respect
  invincibility and one-hit survivor effects, but damage modifiers cannot make them non-lethal.
- Falling below `DEATH_FLOOR_Y` kills even an invincible player; invincibility only negates
  damage. Falls use `FALL_SOURCE` and never record a hit.
- Avoidable hits are recorded before invincibility or mitigation, so `hpLoss` can be 0. Every
  alive-to-dead transition is recorded, tagged or not.
- `collectAvoidableSources` keys must match the key shape of `mechanicSource`
  (`eventId` or `eventId:slot`). Status-effect damage is classified by the effect's own
  `avoidable` flag instead.

### Movement (`src/engine/systems/playerMovement.ts`)

- Landing only catches a player descending through the floor from above (`prevY >= 0`); a player
  already below the floor keeps falling even back over a zone.
- Horizontal knockback decelerates with `KNOCKBACK_FRICTION` (`v0 = sqrt(2 · friction · distance)`);
  an airborne knockup keeps constant horizontal speed until it lands.

### Mechanic semantics worth knowing before editing a system

- **Targeted casts** choose their target and center at resolve, not at cast start, so the floor
  marker stays hidden until then.
- **Stored cleaves** (`deferred: true`) never lock facing and stay dormant after their own cast
  bar; a linked `bait` recomputes the geometry from the boss's locked facing and shares its
  `resolveAt`.
- **Group stacks** rebuild their `FloorAoe` every tick from the marked player's live position.
- **Tethers** keep their target until it dies, and interception is checked before every scheduled
  fire, not just the first.
- **Black Hole tether order** is locked lazily the first time any of a hazard's lasers promotes,
  sorted clockwise from the `orderFrom` boss (bearing 0 = north, clockwise, i.e. `atan2(x, z)`;
  ties by absolute bearing). A later boss teleport cannot reshuffle it.
- **Reassign** labels repeat across tower waves, but each wave resolves on a different tick, so
  `ctx.time` keeps applied effect ids unique.

### Generic bot solver (`src/engine/bots/genericSolver.ts`)

Resolved ids extend the event id with dot-separated RNG outcome segments, and rules match by
segment prefix or exact label:

| Mechanic | Resolved id |
|----------|-------------|
| inverse | `id.inverted` / `id.shown`, then `.a` / `.b` |
| spread_stack | `id.` + the **actual** mode (inversion already applied) |
| gaze | `id.reverse` / `id.normal` |
| group | `id.g<chosen index>` |

- Pending towers report their real `[t, t + telegraph]` window and only become live at `t`, so a
  later wave never bleeds into the current wave's soak window.
- Limit cuts stay live for their effect duration so rules can gate on them.
- `nearestEdge` ties break toward `from`'s own side of the line, then toward the axis's forward
  direction, so the result is seed-independent.
- The frame helpers are exported so client readouts use the same north vectors as the solver.

## Client netcode

- Hash reports happen on fixed tick boundaries (`HASH_INTERVAL`) so every client hashes the same
  ticks. They are checked per applied tick using that tick's world, never `replica.appliedTick`
  after the batch, which would skip or duplicate boundaries.
- `worldHash`, `snapshot` and `simEnded` echo the `pull` epoch from the last `started`, so a report
  still in flight from a previous pull is dropped instead of acting on the new one.
- There is no reconnect path. A frame gap or unexpected room leave ends the session
  (`sessionExpired`); Colyseus automatic reconnection is disabled on join.
- `loop.ts` sends continuous intent at most once per `TICK_MS`. A high-refresh display otherwise
  exceeds `MAX_WS_MSGS_PER_SEC`, and the limiter silently drops hash, snapshot and `simEnded`
  reports along with the intents.
- `NetClient.playing` gates prediction: pause, stop and done leave `world.status` as `running`, so
  status alone would let a player nudge a frozen character.
- `loop.ts` replays jump/sprint that the one-shot sink already sent into the next predicted frame;
  the rAF frame's `getIntent` sees them as already consumed.
- The predictor mirrors `playerMovement.ts` and only hard-snaps past a divergence threshold
  (teleport, forced march, respawn). There is no drift correction: since the relay never drops
  ticks, the authoritative path converges on the prediction by itself.
- `replayInsights.ts` steps exactly like `SimulationReplica.stepOne` and drains `world.log` each
  tick. A lethal avoidable hit records the hit and the death in one tick; the review merges them.
- `replayTransport.ts` caps catch-up at 4 s of ticks per timer fire (for example after a
  backgrounded tab).
- Shared replays: each seek re-simulates from tick 0 on every follower, so the host shares seeks on
  a trailing timer. Generation counters drop replay fetches that a newer choice superseded.
- Leaving via Home sends `leave` rather than `stop`, so the host is not bounced back into the sim
  by the broadcast `started`. Automatic returns to the workshop keep reservations.

## Server

- `FrameRelay` never discards accumulated time: dropped ticks would make authoritative positions
  lag real input forever. `MAX_CATCHUP_SECONDS` only bounds pathological gaps (process suspension,
  debugger). The scheduler polls every 5 ms so frames go out close to ideal 60 Hz times. A pull
  whose host never sends `simEnded` ends at its duration plus 30 s.
- `DesyncTracker` treats the host's hash as canonical for a tick, so an honest client is never
  "resynced" toward a diverged one that reported first. Reports are rate-capped and the pending
  table is bounded. Hash, snapshot and `simEnded` count only from pull participants (and, for the
  latter two, only from the host while in the pull). Losing the host hands the host off to the next
  connected pull participant instead of ending the raid.
- `frames` go only to pull participants, via one encoded `Room.broadcast`. Clients outside the pull
  would otherwise step stale replicas.
- The pull's tick-zero `World` is frozen once `inputLog` is non-empty: resync replays from it, and
  frames already carry all per-tick control state.
- Host snapshots are stored and relayed opaquely; the server never interprets them.
- `clientIpFor` trusts the first `X-Forwarded-For` entry because production always runs behind
  Caddy. Over-limit messages are dropped, not disconnected, so a legitimate burst does not end a
  session.
- `/metrics` runs on a separate port, refuses to start without `METRICS_TOKEN`, and compares the
  token in constant time.
- The logger's SIGINT/SIGTERM handlers must flush every writer and then exit, because registering
  them disables the default termination. Per-pull input logs (`logs/sessions/<id>.jsonl`) start
  with the tick-0 world and are written regardless of `LOG_LEVEL`.
- Colyseus: HTTP routes are registered through the `express` server option, not
  `transport.getExpressApp()`. That makes Colyseus skip its default `GET /` handler and registers
  the routes before the matchmaking router. Its `res.send()` is binary-safe, so files are sent as a
  `Buffer` with an explicit `Content-Type`.

## Client rendering

- **Tree-shaking workarounds** (`BabylonRenderer.ts`): sub-path Babylon imports let Bun strip
  engine extensions nothing references. Some builds (notably Windows `bun run start`) lost them,
  so models never rendered and transparent materials drew opaque. `RegisterFullEngineExtensions()`
  restores them. `RegisterAnimatable()` does the same for the animation runtime; without it every
  animated GLB fails with "Cannot set properties of undefined (setting 'weight')". Together with
  `--ignore-dce-annotations` these cost only about 60 KB of the ~4.7 MB bundle (measured with
  `build:analyze` on Bun 1.4.2), so they stay.
- The canvas renders at device pixel ratio capped at 2. `skipPointerMovePicking` is on because
  nothing is pickable.
- **Pointer lock:** the first pointer move after lock carries the cursor warp to screen center;
  the wrapped `onTouch` drops it. Losing the lock without a pointerup clears drag state.
- Boss layers are keyed by model and ring settings as well as id, because raids reuse boss ids.
- **Boss models must be static.** Voxel exports put every cube in its own mesh (about 760 for
  Chaos), and the CPU cost of one draw call per mesh dropped Black Hole below 144 fps even while
  stopped. `BossLayer` merges the loaded meshes per material, which bakes away the node
  hierarchy, so per-part animation isn't possible. New `static/model/boss/*.glb` files should also
  be pre-joined offline, which about halves their size:
  `bunx @gltf-transform/cli dedup` → `flatten` → `join` → `prune`, each writing `in.glb out.glb`.
  Don't use Draco or meshopt compression, because the loader has no decoders set up.
- **Health bars** (`HealthBarLayer.ts`) share one fullscreen GUI and use `linkWithMesh`, which must
  follow `addControl`. The bars draw as a 2D overlay without 3D occlusion.
- **Heights:** the AOE telegraph plane is at y = 0.01; arena floor art sits below it to avoid
  z-fighting. The boss ring is at 0.03 and the target ring slightly above.
- The arena floor shows a crosshatch until its image loads; the load callback checks
  `isDisposed()` because a quick raid switch can dispose the floor mid-download.
- **Shared materials:** element floor materials are shared per (element, color, alpha) and must
  never be disposed by callers. `FloorAoe` is immutable, so a new instance under the same id means
  the mesh is rebuilt, not moved. Per-mechanic materials elsewhere are not shared because their
  alpha and colors animate per instance.
- A glow layer with an empty include list glows every emissive mesh, so `meshGlow` disables it
  when there are no targets.
- Element burst particle systems are not `disposeOnStop` (that would free the shared dot texture)
  and are disposed a frame later, since the callback fires while the scene iterates particles.
- Telegraph bursts only fire for hits that landed recently, and the set of burst AoEs resets when
  the clock rewinds, so replay seeks do not replay old bursts.
- The voxel death burst is a pure function of pull seed, player id and sim time since death
  (mulberry32, dmath, fixed-step physics), so it pauses and seeks correctly.
- `preloadAssets` warms the browser cache for every model and icon; `/static` is served with a
  `Cache-Control` that lets the warmed bytes be reused.
- HUD cooldown sweeps are quantized to whole degrees and the FPS text refreshes a few times a
  second, so the DOM is not rewritten every frame. The FPS value comes from `engine.getFps()`, which
  only updates because `BabylonRenderer.render()` wraps `scene.render()` in `engine.beginFrame()` /
  `endFrame()`. Babylon measures FPS in `beginFrame`, and the app does not use `runRenderLoop`.
  Non-finite values (the first frame) are skipped. The same box lists ping, from the Colyseus room
  ping polled every 2 s, and the average of the last 15 samples, about 30 s.
- HUD layout (`hudGeometry.ts`): an element is drawn with `translate(-50%, -50%) scale(total)`,
  so a placement is a centre point plus a total scale (UI scale × group scale). The measured group
  box is stored at scale 1 as `natural` size plus `offset` from the element centre.
- The guided tour re-measures on a timer because HUD moves and the `zoom`-based UI scale fire no
  resize event; `#yas-tour` is zoomed too, so screen pixels are divided by the scale.
- `Dropdown` replaces native `<select>`, whose popup uses OS chrome that ignores the theme.
- Every `localStorage`/`sessionStorage` access tolerates the storage being unavailable (private
  browsing).

## Client CSS (`src/client/style-*.css`)

- Form controls do not inherit `font-family` from `body`, so the pixel font is set on them globally.
- Rules that set `display` beat the user-agent `[hidden]` rule, so such elements restate
  `[hidden] { display: none }` explicitly.
- Overlay containers are zoomed by `--ui-scale`; the 3D canvas is not. Viewport units ignore the
  root zoom, so sizes that must fit the viewport (the tour card) are set from JS instead.
- The guided tour sits above `#info-panel` (z-index 220) and `#settings-panel` / the top buttons
  (210), so it stays on top when reopened from the About panel.
- Chakra Petch renders larger than Jersey 10 at the same size; readable mode shrinks it with
  `font-size-adjust` to match Jersey 10's x-height.
- The boot overlay is plain HTML in `index.html` so it shows while the app bundle downloads.

## Input (`src/client/input.ts`, `src/client/actions.ts`)

- Controller bindings: a combo is a face or d-pad button optionally gated by one held modifier
  (LT/RT/LB/RB). Each modifier swaps the whole 8-button layer: 5 layers × 8 = 40 combos.
- A DualSense in non-standard mode reports face buttons in physical order `[□, ✕, ○, △]`, the
  right-stick Y on `axes[5]` and the L2 trigger on `axes[3]`. D-pad and shoulder indices vary by
  device and should be confirmed on hardware.
- **Legacy** scheme: W/S, Q/E and A/D all move relative to the camera and combine; the character
  faces the travel direction (pure Q/E strafe faces camera-forward). **Standard** scheme: facing
  changes only via A/D turns or right-mouse free-look, WSQE move relative to the character, and the
  camera trails the character unless the mouse drives it.
- While input is blocked (for example during the guided tour), held pad buttons are latched so
  nothing fires on release. Tab never moves browser focus.

## Docs site (`docs-site/`)

- `docs:dev` builds into its own directory so a running preview cannot race `docs:build`/`docs:check`.
- Unpublished pages are listed in `nav.ts` so `docs:check` still reports genuinely forgotten files.
- Heading slugs match GitHub's, so existing anchors keep working; the renderer generates heading
  ids itself because Bun's Markdown renderer does not.
