# Authoring Raids

Raids are YAML files in the `raids/` directory. Each file describes an arena, a fixed
roster of 8 players, and a timeline of events (mechanics) that resolve over time.
The server validates every file against a strict schema (`src/engine/raidSchema.ts`) on
load — an invalid file throws and the raid won't start.

## File location & naming

- Put raid files in `raids/<category>/<id>.yaml` (or `.yml`).
- The server resolves extensions in order: `.yaml` → `.yml` — the first match wins.
- `<id>` is the filename without extension and must match `^[a-z0-9][a-z0-9-]{0,63}$`
  (lowercase letters, digits, hyphens; can't start with a hyphen). It's the id used in the
  raid list and join URLs.
- The server lists all raid files in each category directory, **except** files named
  `raid_info` or ending in `-bots` — those are metadata/bot-pattern files
  (see [Bot patterns](#bot-patterns)).
- Category metadata and bot-pattern files use the same YAML extensions (`raid_info.yaml`,
  `*-bots.yaml`).

## Top-level shape

YAML supports comments, anchors, and compact flow-style maps/lists for short fragments.
Excerpt from `raids/debug/tower-test.yaml`:

```yaml
name: Tower Test
arena:
  zones:
    - kind: circle
      center: [0, 0]
      radius: 20
duration: 26

# Shared tower defaults - merged into each event with <<: *towerBase.
_towerBase: &towerBase
  type: tower
  telegraph: 4
  radius: 3
  failureDamage: 30

events:
  - <<: *towerBase
    id: single-tower
    t: 3
    name: Single Tower
    pos: [0, 12]
    requiredCount: 1
    failureDamageType: magical
```

| Field         | Required | Notes |
|---------------|----------|-------|
| `name`        | yes      | Display name, non-empty. |
| `arena`       | yes      | `zones: [...]`, at least one zone. Defines the walkable floor. |
| `duration`    | yes      | Encounter length in seconds (> 0). The run ends ("cleared") if players survive this long. |
| `botPatterns` | no       | Id of a bot-pattern file (without extension). See [Bot patterns](#bot-patterns). |
| `players`     | yes      | Exactly 8, in the canonical roster order below. |
| `events`      | yes      | Array of events. May be empty. |
| `waymarks`    | no       | Optional visual floor markers (A–D, 1–4). See [Waymarks](#waymarks). |

## Coordinate system

- The arena is a 2D plane. Positions are `[x, z]` arrays.
- `+z` is north (12 o'clock), `+x` is east (3 o'clock); directions go clockwise.
- `y` is the vertical axis (jumping) and is never authored — only `x`/`z` are.
- Players start with 100 HP. Falling off the floor (outside every arena zone) is fatal.

## Arena zones

`arena.zones` is a list; a point is "on the floor" if it's inside **any** zone. Combine
zones to build non-circular arenas. Excerpt from `raids/debug/arena-zones-test.yaml`:

```yaml
arena:
  zones:
    - kind: circle
      center: [0, 0]
      radius: 12
    - kind: rect
      center: [18, 0]
      width: 8
      height: 20
    - kind: polygon
      vertices:
        - [-24, -8]
        - [-14, -8]
        - [-19, 8]
```

- `circle`: `radius` > 0.
- `rect`: axis-aligned, `width`/`height` > 0, centered on `center`.
- `polygon`: at least 3 `vertices`.

## Waymarks

`waymarks` is an optional list of fixed reference markers drawn on the floor — the
A–D / 1–4 spots raiders position around. They are **purely visual**: they have no
collision and never affect damage, targeting, or simulation. Excerpt from
`raids/debug/sample-raid.yaml`:

```yaml
waymarks:
  - { mark: A, pos: [0, 16] }
  - { mark: B, pos: [16, 0] }
  - { mark: "1", pos: [10, 10] }
  - { mark: "2", pos: [10, -10] }
```

| Field  | Required | Notes |
|--------|----------|-------|
| `mark` | yes      | One of `A`, `B`, `C`, `D`, `1`, `2`, `3`, `4`. Each may appear at most once. |
| `pos`  | yes      | `[x, z]` floor position. |

- **Letters (A–D)** render as **circles**, **numbers (1–4)** as **squares**, lying flat
  on the floor, with the character floating translucently above each shape.
- Colors follow the FFXIV convention — A/1 red, B/2 yellow, C/3 blue, D/4 purple.
- Omit the field entirely (or use `[]`) for a raid with no waymarks.

## Roster

`players` must contain exactly these 8 ids, in this exact order and with these roles
(enforced by the schema):

| Index | id   | role    |
|-------|------|---------|
| 0     | `mt` | tank    |
| 1     | `ot` | tank    |
| 2     | `h1` | healer  |
| 3     | `h2` | healer  |
| 4     | `r1` | dps     |
| 5     | `r2` | dps     |
| 6     | `m1` | dps     |
| 7     | `m2` | dps     |

Each player entry. Excerpt from `raids/debug/sample-raid.yaml`:

```yaml
players:
  - id: mt
    role: tank
    spawn: [-12, 12]
```

| Field     | Required | Notes |
|-----------|----------|-------|
| `id`      | yes      | Must match the roster id for its index. |
| `role`    | yes      | Must match the roster role for its index. |
| `spawn`   | yes      | Starting `[x, z]`. |
| `pattern` | no       | Inline movement waypoints (see below). Usually supplied via a `-bots` file instead. |

## Events (the timeline)

Every event has a `type` that selects its schema. `type` defaults to `"aoe"` if omitted,
which is why many AOE examples skip it. Supported event types are `aoe`, `targeted`,
`bait`, `tether_source`, `line_link`, `chain`, `group`, `tower`, `effect_resolver`,
`forced_march`, `effect_burst`, `heal`, `effect_select`, `apply_effect`, `inverse`,
`spread_stack`, `gaze`, and `forsaken_assign`.

All damaging events share the same lifecycle: the cast begins at `t`, and **resolves** at
`t + telegraph`. Damage and effects are snapshotted at resolve time (FFXIV-style) — a
player's position is only checked the instant the cast resolves, so they can dodge by
leaving the area before then.

### Common fields (aoe & targeted)

| Field           | Required | Notes |
|-----------------|----------|-------|
| `id`            | yes      | Stable mechanic id, unique across the raid file. Links and bot solvers use this value. |
| `t`             | yes      | Cast start time in seconds (≥ 0). |
| `name`          | yes      | Mechanic name (shown on the cast bar). |
| `telegraph`     | yes      | Cast duration in seconds (> 0). |
| `damage`        | yes      | Damage applied on hit (≥ 0; use `0` for effect-only mechanics). |
| `damageType`    | yes      | `"physical"`, `"magical"`, or `"true"`. `true` ignores vulnerability multipliers. |
| `applyEffect`   | no       | Buff/debuff applied to those hit (see [Effects](#effects)). |
| `showCastBar`   | no       | `true` shows the on-screen cast bar with name + timer. Defaults to `false`. |
| `showTelegraph` | no       | `true` (default) draws the ground marker. Set `false` for an **invisible** AOE — cast bar and damage still apply, but no floor circle is drawn. |
| `telegraphMode` | no       | `"cast"` (default) draws during the cast and flashes at resolve. `"resolve"` hides the cast marker and only shows the 0.6s resolved flash. `showTelegraph: false` still draws nothing. |

### `aoe` — fixed-shape area

The classic mechanic: a shape on the ground that hits whoever stands in it at resolve.
Excerpt from `raids/debug/sample-raid.yaml`:

```yaml
- id: fireball
  t: 4
  name: Fireball
  telegraph: 3
  damage: 60
  damageType: magical
  showCastBar: true
  shape: { kind: circle, center: [0, 0], radius: 9 }
```

The `shape` is required. See [Shapes](#shapes).

#### Knockback / knockup

An `aoe` event may carry an optional `knockback` that **displaces** every player caught in
the shape at resolve, pushing them directly **away from an origin** (direction is
`player − origin`). It composes with `damage`/`applyEffect` and works with `damage: 0` for a
pure shove. While being displaced a player's own movement input is ignored, so they travel
the full distance. Excerpt from `raids/debug/knockback-test.yaml`:

```yaml
- id: skyward-launch
  t: 15
  name: Skyward Launch
  telegraph: 3
  damage: 0
  damageType: physical
  showCastBar: true
  shape: { kind: circle, center: [0, 0], radius: 30 }
  knockback: { distance: 10, height: 9 }
```

| Field      | Required | Notes |
|------------|----------|-------|
| `distance` | yes      | Horizontal push distance in units (> 0). |
| `height`   | no       | Peak arc height (≥ 0). `0` (default) is a flat ground **knockback**; `> 0` makes it a **knockup** that launches the player in an arc and lands them `distance` away. |
| `origin`   | no       | `[x, z]` point to push away from. Defaults to the shape's center (`circle`/`donut`) or `origin` (`cone`/`rect`). |

Knockback respects the arena: a player shoved off the floor falls and dies via the normal
death-floor logic — the basis for "knock into the void" mechanics.

#### Boss-anchored cleaves (`anchor` / `directionFrom`)

A `cone` or `rect` `aoe` can be locked to the boss instead of fixed coordinates. The values
are **snapshotted when the cast begins** (at `t`), like an FFXIV cleave — the player can then
dodge during the telegraph.

| Field             | Required | Notes |
|-------------------|----------|-------|
| `anchor`          | no       | `"boss"` sets the shape's `origin` to the boss position at cast start. |
| `directionFrom`   | no       | `"bossFacing"` sets the shape's `direction` to the boss's facing at cast start (the boss faces its current threat target). |
| `directionOffset` | no       | Radians to rotate the `bossFacing` direction, clockwise. `0` = front (default), `π` = rear cleave, `-π/2` = the boss's left, `π/4` = front-right. |
| `lockFacing`      | no       | Freezes the boss's facing for the cast's duration (it stops tracking its target), then resumes — keeping it aligned with its snapshotted cleave. **Defaults to `true`**; set `false` to let the boss keep turning mid-cast. |
| `deferred`        | no       | **Stored cleave.** When `true`, the cast shows its cast bar but does **not** resolve at its own `t + telegraph`; it goes dormant (no ground telegraph) until a [`bait`](#bait--turn-lock-and-aim-a-stored-cleave) with a matching `link` arms it. The geometry is then computed from the boss's **locked facing at that moment** (so `directionOffset: 0`/`π` become front/rear relative to the baited player) and detonates together with the bait. Defaults to `false`. |

When you use these, the shape's own `origin`/`direction` may be omitted (they default and are
overridden). Each flag is independent — e.g. `anchor: "boss"` with a static shape `direction` vector
gives a fixed-heading cleave that originates from the boss.

Express a directional cleave with the `cone`'s `angleDeg` (full width) plus `directionOffset`:
a front 90° cleave is `angleDeg: 90` with no offset; a rear cleave adds `directionOffset: 3.14159`
(π); a left half-room cleave is `angleDeg: 180, directionOffset: -1.5708` (−π/2). Excerpt from
`raids/debug/positional-test.yaml`:

```yaml
- <<: *cleaveBase
  id: front-cleave-90
  t: 3
  name: Front Cleave (90)
  shape: { kind: cone, angleDeg: 90, length: 25 }
```

#### Positionals (`positional`)

Gate a directional attack to an **arc relative to the boss's facing**, defined in radians. A
player is hit only if they are both inside the `shape` **and** within the arc — everyone else is
spared. Omit it for a normal (omnidirectional) hit. Excerpt from
`raids/debug/positional-arc-test.yaml`:

| Field    | Required | Notes |
|----------|----------|-------|
| `center` | yes      | Arc center in radians, measured **clockwise from the boss's facing**. `0` = front, `π` = rear, `π/2` = the boss's right, `-π/2` = left, `π/4` = front-right intercardinal, etc. |
| `width`  | yes      | Full angular width of the arc in radians (so the arc spans `center ± width/2`). E.g. `π/2` is a ±45° wedge; `π` is a 180° half cleave; `2π` covers everything. |

```yaml
- id: tail-swipe
  t: 4
  name: Tail Swipe
  telegraph: 4
  damage: 50
  damageType: physical
  showCastBar: true
  shape: { kind: circle, center: [0, 0], radius: 20 }
  positional:
    center: 3.14159
    width: 1.5708
```

Because both values are free radians, you can express any wedge: a rear `±45°` cleave
(`center: π, width: π/2`), an intercardinal hit (`center: π/4`), or a half-room cleave in front
of the boss (`center: 0, width: π`). It combines naturally with a boss-anchored `cone`/`rect`.

### `targeted` — near/far baited circle

A circle that snaps onto a player chosen **at resolve time** (not cast start), so players
can reposition during the telegraph. The ground marker stays hidden until it resolves.
Excerpt from `raids/debug/near-far-bait.yaml`:

```yaml
- type: targeted
  id: healer-snipe-furthest
  t: 16
  name: Healer Snipe (Furthest)
  targetMode: furthest
  role: healer
  radius: 4
  telegraph: 3
  damage: 60
  damageType: magical
  showCastBar: true
```

| Field        | Required | Notes |
|--------------|----------|-------|
| `targetMode` | yes      | `"closest"` or `"furthest"` (measured from arena center), or `"aggro"` — the boss's current threat target (the player holding aggro, normally the MT). `aggro` ignores `role`. |
| `role`       | no       | If set (`tank`/`healer`/`dps`), only that role is eligible to be the target. |
| `radius`     | yes      | Circle radius (> 0). |
| plus all [common fields](#common-fields-aoe--targeted) except `shape`. | | |

### `bait` — turn, lock, and aim a stored cleave

Selects a player **at cast start** (unlike `targeted`, which picks at resolve), turns the boss to
face them, and **locks** its facing for the cast. The bait deals **no damage itself** — its `link`
names a [`deferred` stored cleave](#boss-anchored-cleaves-anchor--directionfrom) that is aimed from
this locked facing and detonates at `t + telegraph`. A stored `future` (front) / `past` (rear) thus
becomes "toward" / "away from" the baited player. Excerpt from
`raids/debug/stored-bait-test.yaml`:

```yaml
- type: aoe
  id: future-ending
  t: 4
  name: Future Ending
  deferred: true
  anchor: boss
  directionFrom: bossFacing
  telegraph: 3
  damage: 80
  damageType: magical
  shape: { kind: cone, angleDeg: 180, length: 25 }
  telegraphMode: resolve
  showCastBar: true

- type: bait
  id: all-things-ending-1
  t: 10
  name: All Things Ending
  targetMode: closest
  telegraph: 4
  link: future-ending
  showCastBar: true
```

| Field         | Required | Notes |
|---------------|----------|-------|
| `targetMode`  | yes      | `"random"` (seeded RNG over living players), `"closest"`, or `"furthest"` (both measured from the boss). |
| `role`        | no       | If set (`tank`/`healer`/`dps`), only that role is eligible to be baited. |
| `telegraph`   | yes      | Cast duration; the linked cleave detonates at `t + telegraph`. |
| `link`        | yes      | Id of an earlier `aoe` with `deferred: true` (the stored cleave) to aim and detonate. |
| `showCastBar` | no       | Show the boss cast bar for the duration of the bait. |

A full two-cast sequence (stored `Future Ending` cleave -> 3s -> baited `All Things Ending`) lives in
`raids/debug/stored-bait-test.yaml`.

### `tether_source` — buff/debuff tether

Spawns a tether anchor at a point. The nearest player gets tethered; when it finalizes
after `finalizeAfter` seconds, the effect is granted (or, for a debuff, applied unless
intercepted). Excerpt from `raids/debug/tether-test.yaml`:

```yaml
- type: tether_source
  id: void-chain
  t: 5
  name: Void Chain
  pos: [0, -14]
  finalizeAfter: 7
  tetherKind: debuff
  buffName: Doom
```

| Field            | Required | Notes |
|------------------|----------|-------|
| `t`              | yes      | When the tether spawns. |
| `name`           | yes      | Mechanic name. |
| `pos`            | yes      | `[x, z]` anchor position. |
| `finalizeAfter`  | yes      | Seconds until the tether locks in (> 0). |
| `tetherKind`     | yes      | `"buff"` or `"debuff"`. |
| `buffName`       | yes      | Name of the granted effect. |
| `behavior`       | no       | Effect behavior (see [Effects](#effects)). Defaults to `{ kind: none }`. |
| `effectDuration` | no       | Duration of the granted effect in seconds (> 0). Defaults to `15`. |
| `icon`           | no       | HUD icon filename for the granted effect, served from `static/effects/`. |

### `line_link` — fixed visual links from an object to selected players

Spawns non-grabbable lines from a source position to selected players. Each target receives
a hidden debuff immediately. The visual lines can disappear before the debuff resolves; at
`t + resolveAfter`, only the stored targets resolve and can receive an effect and/or knockback.
Unlike `tether_source`, these lines do not retarget or get intercepted. Excerpt from
`raids/debug/line-link-test.yaml`:

```yaml
- type: line_link
  id: north-statue
  t: 4
  name: North Statue
  pos: [0, 34]
  linkDuration: 3
  resolveAfter: 10
  target: { roles: [dps], count: 4, mode: closest }
  hiddenDebuffName: Line Linked
  applyEffect:
    name: Magic Vulnerability
    kind: debuff
    duration: 8
    behavior: { kind: vuln, damageType: magical, multiplier: 1.5 }
  knockback: { distance: 12 }
  visual: { kind: statue, width: 3, height: 5, depth: 1 }
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"line_link"`. |
| `id` | yes | Stable mechanic id, unique across the raid file. Used by another line link's `link` field. |
| `t` | yes | When the link spawns. |
| `name` | yes | Mechanic name. |
| `pos` | yes | `[x, z]` source position. For a north statue, place this outside the arena at positive `z`. |
| `resolveAfter` | yes | Seconds until the link resolves (> 0). |
| `linkDuration` | no | Seconds the visual lines remain before disappearing. Defaults to `resolveAfter`. |
| `target` | no | `mode` (`"closest"`/`"furthest"`), `roles`, `playerIds`, and/or `count`. If both `roles` and `playerIds` are set, both filters must match. Defaults to closest alive player. |
| `target.roleGroups` | no | Two role filters to choose between, e.g. `[["dps"], ["tank", "healer"]]`. The chosen group becomes `target.roles`. |
| `target.count` | no | Number of eligible targets selected. Defaults to `1`, or to `playerIds.length` when `playerIds` is supplied. |
| `rng` | no | With `target.roleGroups`, pick a seeded random role group. Without `rng`, choose the first group. |
| `link` | no | With `target.roleGroups`, take the complement of the referenced line link's chosen role group. The source line link must appear earlier, or earlier in the file when `t` is the same. |
| `hiddenDebuffName` | yes | Name of the hidden simulation debuff applied while the line is active. It does not show in the HUD. |
| `applyEffect` | no | Visible buff/debuff applied to the linked player at resolve. |
| `knockback` | no | Knockback applied to each stored target at resolve; defaults to origin `pos` unless `knockback.origin` is set. |
| `visual` | no | `{ kind: statue }` draws a rectangular statue at `pos`; dimensions default if omitted. |

### `chain` — break-apart pair chains

Chains a set of **explicitly named player pairs** together. While the cast bar counts down
(for `telegraph` seconds) a chain icon floats over each chained player's head. At cast end a
`debuffName` debuff is applied to both members and a line connects them. Each pair then has
`breakWindow` seconds to **increase their separation by `breakDistance`**: the threshold is the
pair's distance when the chain connects *plus* `breakDistance` (e.g. starting 5 apart with
`breakDistance: 6` breaks at 11; starting on top of each other breaks at 6). Breaking removes
the debuff (no damage). Any pair still chained when the window closes takes a single
burst of `breakDamage` (vulnerabilities apply per the pair's `damageType`). Excerpt from
`raids/debug/chain-test.yaml`:

```yaml
- type: chain
  id: binding-chains
  t: 4
  name: Binding Chains
  pairs: [[mt, h1], [ot, h2]]
  telegraph: 4
  breakWindow: 6
  breakDistance: 12
  breakDamage: 40
  damageType: magical
  debuffName: Chain Bond
  showCastBar: true
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"chain"`. |
| `t` | yes | Cast start time (seconds). |
| `name` | yes | Mechanic name (used in the log and cast bar). |
| `pairs` | yes | Array of `[idA, idB]` player-id pairs (≥ 1). Each pair becomes its own chain. Ids must exist in the roster. |
| `telegraph` | yes | Cast duration in seconds (> 0) — head icon + cast bar. |
| `breakWindow` | yes | Seconds after the cast to break the chain before damage (> 0). Also the debuff's duration. |
| `breakDistance` | yes | Extra separation (> 0) the pair must add beyond their starting distance to break the chain. |
| `breakDamage` | yes | Burst damage dealt to both members if the chain isn't broken in time (≥ 0). |
| `damageType` | yes | `"physical"`, `"magical"`, or `"true"`. |
| `debuffName` | yes | Name of the debuff shown on both members until they break or get hit. |
| `showCastBar` | no | Show the cast bar during the telegraph. Default `false`. |

### `group` — random shared-damage stack

Picks **one of several candidate groups** of players, marks a *random member* of that group with
a stack marker, and at cast end deals **shared damage** to everyone standing within `radius` of
the marked player. Use it for "stack on a random player" mechanics where the target is randomised.

- The `groups` only decide **who can be marked** (and how `link` pairs up); the actual damage is
  **positional** — players must move into the marked player's circle to share it.
- **Shared damage:** on success the total `damage` is split evenly across the soakers inside the
  radius (`damage / soakerCount` each). The marked player is always a soaker.
- **Failure threshold:** if fewer than `requiredCount` players are inside the radius at resolve,
  the stack **fails** and every soaker takes the *full, unsplit* `damage` (usually lethal).
- `rng: true` picks a random group **each run** (true randomness — not seeded). Without `rng` it
  always picks the first group.
- `link: "<id>"` makes this event mark a member of the **complementary** group of an earlier
  `group` event ("repeat with the opposite group"). The linked source must occur at an earlier
  `t`, and both events must have **exactly two** groups.

Excerpt from `raids/debug/rng-stack.yaml`:

```yaml
- type: group
  id: stack-1
  t: 4
  name: Shared Sentence
  rng: true
  groups: [[h1], [h2]]
  telegraph: 5
  radius: 6
  requiredCount: 4
  damage: 200
  damageType: magical
  showCastBar: true
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"group"`. |
| `t` | yes | Cast start time (seconds). The group + marked member are chosen now. |
| `name` | yes | Mechanic name (used in the log and cast bar). |
| `groups` | yes | Array of groups; each group is a list (≥ 1) of player ids. One member of the chosen group is marked. Ids must exist in the roster. |
| `telegraph` | yes | Cast duration in seconds (> 0) — marker + circle + cast bar; damage applies at the end. |
| `radius` | yes | Radius (> 0) of the stack circle around the marked player; players inside it share the hit. |
| `damage` | yes | **Total** shared damage (≥ 0), split evenly across the soakers on success. |
| `damageType` | yes | `"physical"`, `"magical"`, or `"true"`. |
| `requiredCount` | no | Soakers needed inside the radius to share the hit; fewer = the stack fails (full damage each). Default `1`. |
| `id` | yes | Stable mechanic id, unique across the raid file. |
| `rng` | no | Pick a random group instead of the first. Default `false`. |
| `link` | no | Id of an earlier `group` event whose complementary group to take (both must have 2 groups). |
| `applyEffect` | no | Debuff/buff applied to each hit soaker (same shape as on `aoe`). |
| `showCastBar` | no | Show the cast bar during the telegraph. Default `false`. |

See `raids/debug/rng-stack.yaml` for a linked pair demonstrating opposite-group assignment.

### `inverse` — "?" telegraph (lie / opposite-side)

A Kefka-style **question-mark** puzzle. The mechanic has two sets of shapes: `shownShapes`
(the telegraph that **is** drawn) and `hiddenShapes` (not drawn). A per-cast **inversion** flag
decides which set actually deals damage:

- **Not inverted** (honest): the **shown** shapes are lethal — dodge the telegraph as usual.
- **Inverted** (the "?"): the shown telegraph is a **lie** — it deals no damage; the **hidden**
  shapes (the opposite side) are lethal instead.

A player is hit if they stand in **any** lethal shape. Use shape arrays to make one mechanic a
combo, e.g. two cones forming an intercardinal X.

**Inversion state** is decided at cast start, in this precedence:
1. `questionMark: true | false` — authored override (always / never inverted).
2. else `rng: true` — randomised each run (true randomness — not seeded), 50/50.
3. else — not inverted.

**Visuals.** The shown telegraphs are drawn on the floor. Each mechanic also gets **one ring**
around the boss to identify it (`ringColor`) at an authored height (`ringHeight`). The two orbs
riding the ring encode the state: **dark blue = real**, **reddish-orange with a yellow "?" =
fake** (inverted). Excerpt from `raids/debug/inverse-test.yaml`:

```yaml
- type: inverse
  id: coin-flip-cross
  t: 19
  name: Coin Flip Cross
  telegraph: 5
  damage: 50
  damageType: magical
  showCastBar: true
  rng: true
  ringColor: "#a855f7"
  ringHeight: 3.2
  shownShapes:
    - { kind: cone, origin: [0, 0], direction: [-1, 1], angleDeg: 80, length: 22 }
    - { kind: cone, origin: [0, 0], direction: [1, -1], angleDeg: 80, length: 22 }
  hiddenShapes:
    - { kind: cone, origin: [0, 0], direction: [1, 1], angleDeg: 80, length: 22 }
    - { kind: cone, origin: [0, 0], direction: [-1, -1], angleDeg: 80, length: 22 }
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"inverse"`. |
| `t` | yes | Cast start time (seconds). The inversion is rolled now. |
| `name` | yes | Mechanic name (used in the log and cast bar). |
| `telegraph` | yes | Cast duration in seconds (> 0); damage applies at `t + telegraph`. |
| `damage` | yes | Damage (≥ 0) dealt to each player in a lethal shape. |
| `damageType` | yes | `"physical"`, `"magical"`, or `"true"`. |
| `shownShapes` | yes | Array (≥ 1) of [shapes](#shapes) that are drawn; lethal when **not** inverted (variant **a**). |
| `hiddenShapes` | yes | Array (≥ 1) of shapes that are **not** drawn; lethal when inverted (variant **a**). |
| `shownShapesB` | no | Variant **b** drawn shapes. Required together with `hiddenShapesB` when `variantRng` is set. |
| `hiddenShapesB` | no | Variant **b** hidden shapes. |
| `variantRng` | no | Randomise the **orientation** each run (50/50 a vs b). When `b` is rolled, the `*ShapesB` sets replace `shownShapes`/`hiddenShapes` before the inversion is rolled, giving 4 outcomes (a/b × honest/`?`). Needs both `shownShapesB` and `hiddenShapesB`. Default `false`. |
| `questionMark` | no | Force the inversion state (`true` = always the "?", `false` = never). Overrides `rng`. |
| `rng` | no | Randomise the inversion each run (50/50). Default `false` (not inverted). |
| `ringColor` | no | Hex colour of this mechanic's boss ring (identifies it). Default white. |
| `ringHeight` | no | Vertical height of the boss ring. Default `2`. |
| `applyEffect` | no | Debuff/buff applied to each hit player (same shape as on `aoe`). |
| `knockback` | no | Knockback applied to each hit player (same shape as on `aoe`). |
| `showCastBar` | no | Show the cast bar during the telegraph. Default `false`. |

See `raids/debug/inverse-test.yaml` for honest / `?` / random crosses.

### `spread_stack` — "?" that flips spread ↔ stack

A fire "?" puzzle that resolves as **either spread or stack**. It shows one marker during the
cast (`shown`); a per-cast **flip** decides what actually happens when the cast bar ends:

- **Not inverted** (honest): it resolves as the `shown` mode.
- **Inverted** (the "?"): the shown marker is a **lie** — it resolves as the **opposite** mode.

The two modes:
- **spread** — every alive player drops a small personal AOE (`spread.radius`). A player takes
  `spread.damage` **once per circle they stand in**, so standing in another player's circle eats
  their hit too (each player always eats their own once). Spread everyone out.
- **stack** — **one random member of *each* `stack.groups` is marked**, so two groups give two
  separate stacks. Players within `stack.radius` of a marked player split that stack's
  `stack.damage`; fewer than `stack.requiredCount` soakers → that stack **fails** and each soaker
  eats the full, unsplit hit.

**Flip state** is decided at cast start, in this precedence: `questionMark` (authored override)
> `rng` (seeded 50/50, true variation each pull) > not inverted.

`shown: "random"` picks spread or stack per pull (seeded) — only **one** mechanic ever displays,
and the flip can still make it a lie.

**Visuals.** Like `inverse`, the mechanic gets **one boss ring** (`ringColor` at `ringHeight`)
with two orbs encoding the state (**dark blue = real**, **reddish-orange + yellow "?" = fake**).
Use a height **above** any concurrent `inverse` ring to stack the two readouts. While casting,
the spread form draws a downward triangle over **every** player's head; the stack form draws an
orange **"ring with triangles pointing in" marker on top of the marked character's head**.
Excerpt from `raids/debug/spread-stack-test.yaml`:

```yaml
- type: spread_stack
  id: coin-flip
  t: 31
  name: Coin Flip (random shown + ?)
  telegraph: 4
  shown: random
  rng: true
  damageType: magical
  spread: { radius: 4, damage: 40 }
  stack:
    groups: [[r1, r2, m1, m2], [h1, h2, mt, ot]]
    radius: 6
    requiredCount: 4
    damage: 120
  ringColor: "#f97316"
  ringHeight: 7
  showCastBar: true
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"spread_stack"`. |
| `id` | yes | Stable mechanic id, unique across the raid file. Generic-solver rules match it as `<id>.spread` / `<id>.stack`. |
| `t` | yes | Cast start time (seconds). The flip + marked member are rolled now. |
| `name` | yes | Mechanic name (used in the log and cast bar). |
| `telegraph` | yes | Cast duration in seconds (> 0); resolves at `t + telegraph`. |
| `shown` | yes | Marker drawn during the cast: `"spread"`, `"stack"`, or `"random"` (seeded pick each pull). |
| `damageType` | yes | `"physical"`, `"magical"`, or `"true"`. |
| `spread.radius` | yes | Each player's personal AOE radius (> 0). |
| `spread.damage` | yes | Damage (≥ 0) per circle a player stands in. |
| `stack.groups` | yes | Groups of player ids; **one member per group is marked** → one stack circle each. |
| `stack.radius` | yes | Stack circle radius around each marked player. |
| `stack.requiredCount` | no | Soakers needed per stack to split the hit; fewer = full damage each. Default `1`. |
| `stack.damage` | yes | Damage (≥ 0) per stack, split evenly among that stack's soakers on success. |
| `questionMark` | no | Force the flip state (`true` = always the "?", `false` = never). Overrides `rng`. |
| `rng` | no | Randomise the flip each run (seeded 50/50). Default `false` (honest). |
| `ringColor` | no | Hex colour of this mechanic's boss ring. Default fire orange `#f97316`. |
| `ringHeight` | no | Vertical height of the boss ring. Default `2`. |
| `showCastBar` | no | Show the cast bar during the telegraph. Default `false`. |

See `raids/dancing-mad-ultimate/graven-image-3.yaml` ("Mystery Magic 3 (Fire)") for a flip running
alongside an `inverse` with a fire ring above the lightning ring.

### `gaze` — look-away / "?" eye

An FFXIV-style **gaze**. An eye board appears in the world (`pos`, usually to the north) and at
`t + telegraph` checks which way each player is **facing**:

- **Normal eye** (`reverse: false`): you are hit if you are **looking at** the eye — turn your
  back to dodge ("look away").
- **Reverse "?" eye** (`reverse: true`): the opposite — you are hit if you are **not** looking
  at it, so you must **face** it.

"Looking at" means the eye falls within your facing hemisphere. The width is `coneHalfAngle`
(radians, default `π/2` ≈ the whole front 180°). Players turn by flicking the move stick toward
a direction and stopping — facing persists, so you can re-face without walking far.

**Reverse state** is decided at cast start: `rng: true` rolls it (seeded, 50/50); otherwise the
authored `reverse` value (default `false`) is used. The drawn icon reflects the rolled state — a
plain eye, or an eye with a yellow "?". Excerpt from `raids/debug/gaze-test.yaml`:

```yaml
- type: gaze
  id: evil-eye
  t: 3
  name: Evil Eye
  telegraph: 4
  damage: 40
  damageType: magical
  showCastBar: true
  pos: [0, 19]
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"gaze"`. |
| `t` | yes | Cast start time (seconds). The reverse state is rolled now. |
| `name` | yes | Mechanic name (used in the log and cast bar). |
| `telegraph` | yes | Cast duration in seconds (> 0); damage applies at `t + telegraph`. |
| `damage` | yes | Damage (≥ 0) dealt to each hit player. |
| `damageType` | yes | `"physical"`, `"magical"`, or `"true"`. |
| `pos` | yes | `[x, z]` of the eye board (the thing you face toward/away from). |
| `reverse` | no | `true` = "?" eye (face it); `false` = normal eye (look away). Default `false`. |
| `rng` | no | Randomise `reverse` each run (seeded, 50/50). Default `false`. |
| `coneHalfAngle` | no | Half-angle (radians) counted as "looking at" it. Default `π/2` (front 180°). |
| `applyEffect` | no | Debuff/buff applied to each hit player (same shape as on `aoe`). |
| `knockback` | no | Knockback applied to each hit player (same shape as on `aoe`). |
| `showCastBar` | no | Show the cast bar during the telegraph. Default `false`. |
| `visual` | no | Eye board dimensions `{ width, height, depth }`. Defaults `4 × 3 × 0.4`. |

See `raids/debug/gaze-test.yaml` for normal / reverse / random eyes.

### `tower` — soak circle

A `tower` is a flat circle on the floor that players must stand in ("soak") before it
resolves. At resolve time (`t + telegraph`) the engine counts the **valid soakers** inside:

- If there are fewer than `requiredCount` valid soakers, the tower **fails** and the whole
  raid takes `failureDamage` (raidwide, applied flat — vulnerabilities do not amplify it).
- If it succeeds, each valid soaker optionally receives `applyEffect` and/or `knockback`.
- If `resolveEventIds` is set, each referenced `effect_resolver` triggers for valid soakers
  inside the tower who carry that resolver's `effectName`; those matching debuffs are then removed.
  This happens even if the tower has too few valid soakers and fails.
- If `requiredRoles` is set, only those roles count as valid soakers. A wrong-role player
  standing in the tower is ignored — unless `wrongRoleLethal` is `true`, in which case they
  die. (Think FFXIV "support" towers: `requiredRoles: ["tank", "healer"]`.)

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"tower"`. |
| `t` | yes | Telegraph start time (seconds). |
| `name` | yes | Mechanic name (used in the log). |
| `telegraph` | yes | Seconds from `t` until it resolves. |
| `pos` | yes | `[x, z]` center of the tower circle. |
| `radius` | yes | Circle radius (> 0). |
| `requiredCount` | no | Valid soakers needed to clear it. Default 1. |
| `requiredRoles` | no | Array of `"tank"`/`"healer"`/`"dps"`; only these count as soakers. |
| `wrongRoleLethal` | no | If `true`, a wrong-role soaker dies on resolve. Default `false`. Only meaningful with `requiredRoles`. |
| `failureDamage` | yes | Raidwide damage applied to all alive players if the tower isn't soaked. |
| `failureDamageType` | yes | `"physical"`, `"magical"`, or `"true"`. |
| `applyEffect` | no | Debuff/buff applied to valid soakers on success (see [Effects](#effects)). |
| `knockback` | no | Knockback applied to valid soakers on success (see [Knockback / knockup](#knockback--knockup)). |
| `resolveEventIds` | no | Array of `effect_resolver` ids to trigger for valid soakers carrying matching debuffs. |
| `visual` | no | Floor/marker visuals (see below). |

The optional `visual` object controls how the tower is drawn (the flat disk + ring is always
shown):

| Field | Notes |
|-------|-------|
| `pillar` | `true` draws a static column in the center. |
| `countCircles` | `true` draws one small floor circle per `requiredCount`, filling as players step in. |
| `fallingCylinder` | Legacy alias for `fallingObject: "cylinder"`. |
| `fallingObject` | `"cylinder"`, `"sphere"`, or `"box"`; descends in time with the cast and reaches the floor at resolve. |
| `groundStyle` | `"standard"` (yellow inner line, red outer edge) or `"tank"` (two red lines). Defaults to `"standard"`. |
| `cylinderColor` | Hex string (e.g. `"#33ccff"`) for the falling object. Defaults to cyan. |
| `cylinderThickness` | Diameter/width of the falling object (> 0). Defaults to a value scaled from the tower radius. |

Excerpt from `raids/debug/tower-test.yaml`:

```yaml
- type: tower
  id: support-tower
  t: 17
  name: Support Tower
  telegraph: 5
  pos: [-12, 0]
  radius: 3
  requiredRoles: [tank, healer]
  wrongRoleLethal: true
  failureDamage: 40
  failureDamageType: magical
  applyEffect:
    name: Magic Vulnerability
    kind: debuff
    duration: 8
    behavior: { kind: vuln, damageType: magical, multiplier: 1.5 }
  knockback: { distance: 8 }
  visual:
    fallingCylinder: true
    pillar: true
    groundStyle: tank
    cylinderColor: "#cc66ff"
```

See `raids/debug/tower-test.yaml` for a full example with single, multi-soak, and support towers.

### `effect_resolver` — tower-triggered debuff action

An `effect_resolver` is an inert event definition. It does nothing on its own; a tower invokes it
through `resolveEventIds`. At tower resolve, every valid soaker inside who has an active effect
named `effectName` triggers the resolver action, then loses the matching effect.

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"effect_resolver"`. |
| `id` | yes | Referenced by a tower's `resolveEventIds`. |
| `name` | yes | Mechanic name used in damage logs. |
| `effectName` | yes | Active effect name required on the tower soaker. |
| `action` | yes | One of the action objects below. |

Actions from `raids/debug/debuff-tower-test.yaml`:

```yaml
- type: effect_resolver
  id: spread-resolve
  name: Spread Resolve
  effectName: Spread Charge
  action: { kind: spread, radius: 2.5, damage: 8, damageType: magical }
- type: effect_resolver
  id: stack-resolve
  name: Stack Resolve
  effectName: Stack Charge
  action: { kind: stack, radius: 4, requiredCount: 2, damage: 200, damageType: magical }
- type: effect_resolver
  id: cone-resolve
  name: Cone Resolve
  effectName: Cone Charge
  action: { kind: cone_nearest, angleDeg: 70, length: 14, damage: 12, damageType: physical }
```

- **spread** — each triggered carrier drops a circle at their position; everyone inside each circle
  takes the full damage.
- **stack** — each triggered carrier drops a shared circle; if `requiredCount` living players are
  inside, damage splits evenly, otherwise each soaker takes the full damage.
- **cone_nearest** — each triggered carrier fires a cone toward the nearest other living player.
  The carrier is not hit by their own cone.

See `raids/debug/debuff-tower-test.yaml` for tower-gated spread, stack, and cone examples.

### `forced_march` — ground arrow that teleports the first entrant

An armed floor trap drawn as a translucent ring with a direction arrow. The **first** living
player to walk into the zone is instantly teleported `distance` units along `direction`; the trap
is then consumed (it fires once). If no one enters, it expires after `duration`.
Excerpt from `raids/debug/cc-test.yaml`:

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"forced_march"`. |
| `t` | yes | Time the trap arms (seconds, ≥ 0). |
| `name` | yes | Display name (used in the log). |
| `pos` | yes | Center of the trigger zone `[x, z]`. |
| `radius` | yes | Trigger zone radius (> 0). |
| `direction` | yes | Teleport heading, a non-zero `[x, z]` vector (magnitude ignored). |
| `distance` | yes | How far the entrant is flung along `direction` (> 0). Beware flinging players off the arena. |
| `duration` | yes | How long the trap stays armed before expiring (> 0). |

```yaml
- type: forced_march
  id: march-n
  t: 4.5
  name: March N
  pos: [0, 14]
  radius: 1.2
  direction: [0, 1]
  distance: 8
  duration: 25
  preDelay: 0.3
  postDelay: 0.3
```

### `effect_burst` — AOE around every carrier of a named effect

At cast start (`t`) this drops one circular AOE on **each living player who currently has an active
effect named `effectName`** — e.g. a burst around every sleeping player. The circles are snapshotted
at cast start and then resolve exactly like normal `aoe`s at `t + telegraph` (telegraph drawn, damage
+ optional `applyEffect`/`knockback` on resolve). If no one carries the effect, nothing happens. The
burst is independent of the named effect — it deals its own `damage`, unrelated to e.g. the sleep.

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"effect_burst"`. |
| `t` | yes | Cast start (seconds). Carriers + circle centers are snapshotted now. |
| `name` | yes | Mechanic name (cast bar / log). |
| `telegraph` | yes | Cast duration (> 0); circles resolve at `t + telegraph`. |
| `effectName` | yes | Burst around each player carrying an active effect with this exact name. |
| `radius` | yes | Radius (> 0) of the circle dropped on each carrier. |
| `damage` | yes | Damage (≥ 0) to each player inside any burst circle at resolve. |
| `damageType` | yes | `"physical"`, `"magical"`, or `"true"`. |
| `applyEffect` | no | Debuff/buff applied to each hit player (same shape as on `aoe`). |
| `knockback` | no | Knockback applied to each hit player (same shape as on `aoe`). |
| `showCastBar` | no | Show a single cast bar for the set. Default `false`. |
| `showTelegraph` | no | `true` (default) draws the ground circles. |
| `telegraphMode` | no | `"cast"` (default) draws during the cast and flashes at resolve. `"resolve"` hides the cast marker and only shows the 0.6s resolved flash. `showTelegraph: false` still draws nothing. |

Excerpt from `raids/dancing-mad-ultimate/graven-image-3.yaml`:

```yaml
- type: effect_burst
  id: sleeper-burst
  t: 30
  name: Sleeper Burst
  telegraph: 0.5
  effectName: Sleep
  radius: 4
  damage: 40
  damageType: magical
  showCastBar: false
```

### `heal` — restore all living players

Restores every living player to their own maximum HP immediately at `t`. Dead players stay dead.
Excerpt from `raids/dancing-mad-ultimate/graven-image-3.yaml`:

```yaml
- type: heal
  id: raidwide-heal
  t: 35
  name: Raidwide Heal
```

### `effect_select` — random player debuff

Chooses one group, then one random living member from that group, and applies `applyEffect`
immediately at `t`. With a single group, this is a random member from that group.
Excerpt from `raids/dancing-mad-ultimate/graven-image-3.yaml`:

```yaml
- type: effect_select
  id: double-trouble-support
  t: 0
  name: Double Trouble (Support)
  groups: [[mt, ot, h1, h2]]
  applyEffect:
    name: Double Trouble
    kind: debuff
    duration: 24
    behavior: { kind: doubleTrouble, radius: 5, damage: 10, damageType: magical, knockbackDistance: 14 }
```

### `apply_effect` — drop a buff/debuff straight onto players

Applies `applyEffect` to a set of players immediately at `t` — no telegraph, no AOE. Use it to seed
debuffs (DOTs, vulns, markers) without an accompanying mechanic.

Targeting: if `players` is given, only those ids; else if `role` is given, only that role; else
**all** living players. `count` (optional) caps how many of the matched pool are hit — selected in
roster order, or randomly when `rng: true`. Excerpt from
`raids/debug/debuff-tower-test.yaml`:

```yaml
- type: apply_effect
  id: spread-charge
  t: 1
  name: Spread Charge
  applyEffect:
    kind: debuff
    visibility: invisible
    behavior: { kind: none }
    name: Spread Charge
    duration: 12
    markerIcon: defam_processed.png
```

| Field         | Required | Notes |
|---------------|----------|-------|
| `t`           | yes      | When the effect lands (seconds). |
| `name`        | yes      | Mechanic name (used in the combat log). |
| `role`        | no       | Restrict to one role (`tank`/`healer`/`dps`). Ignored if `players` is set. |
| `players`     | no       | Explicit list of player ids to target. |
| `count`       | no       | Cap the number of targets from the matched pool. |
| `rng`         | no       | `true` picks the `count` targets randomly (seeded); otherwise roster order. |
| `applyEffect` | yes      | The buff/debuff to apply (see [Effects](#effects)). |

## Shapes

Used by `aoe` events (`shape`) — a point is hit if it falls inside the shape at resolve.
Shape fragments from `raids/debug/sample-raid.yaml`:

```yaml
shape: { kind: circle, center: [0, 0], radius: 9 }
shape: { kind: donut, center: [0, 0], inner: 7, outer: 30 }
shape: { kind: cone, origin: [0, 0], direction: [0, 1], angleDeg: 90, length: 22 }
shape: { kind: rect, origin: [0, 0], direction: [1, 0], width: 6, length: 40 }
```

- **circle** — `radius` > 0. A full-arena circle (radius = arena radius) is an unavoidable raid-wide hit.
- **donut** — safe in the middle: hits between `inner` and `outer`. Requires `inner` < `outer` (`inner` ≥ 0, `outer` > 0).
- **cone** — fans out from `origin` toward `direction` (a non-zero `[x, z]` vector; magnitude doesn't matter, only heading). `angleDeg` is the full opening angle; `length` is the reach.
- **rect** — a line/lane from `origin` extending along `direction` for `length`, `width` wide (centered on the line).

For `cone`/`rect`, `origin` and `direction` are optional (default `[0,0]` / `[0,1]`) and can be
left out when the event uses [`anchor`/`directionFrom`](#boss-anchored-cleaves-anchor--directionfrom) to
bind them to the boss.

## Effects

`applyEffect` (on aoe/targeted/tower/group/line_link) and `tether_source.behavior` use the same behavior union.
`applyEffect` wraps it with metadata. Excerpt from `raids/debug/debuff-test.yaml`:

```yaml
applyEffect:
  name: Physical Vulnerability
  kind: debuff
  duration: 8
  behavior: { kind: vuln, damageType: physical, multiplier: 1.5 }
```

| Field      | Required | Notes |
|------------|----------|-------|
| `name`     | yes      | Display name. |
| `kind`     | yes      | `"buff"` or `"debuff"`. |
| `duration` | yes      | Seconds the effect lasts (> 0). |
| `visibility` | no    | `"visible"` (default) shows in the HUD; `"invisible"` stores the effect without a HUD chip. |
| `icon`     | no       | HUD icon filename served from `static/effects/` (e.g. `"magic-vuln.png"`). Falls back to a generic glyph chosen from the behavior when omitted. |
| `marker`   | no       | Short text rendered above the player while the effect is active. Works even when `visibility` is `"invisible"`. |
| `behavior` | yes      | One of the behaviors below. |

Normal `aoe` events can instead use `applyEffects` to apply multiple effects from one cast.
Excerpt from `raids/dancing-mad-ultimate/graven-image-3.yaml`:

```yaml
applyEffects:
  order: shuffleBalanced
  effects:
    - name: Plant (short)
      kind: debuff
      duration: 7
      behavior: { kind: plant, direction: option, distance: 6.5, radius: 1.7, armDelay: 3, duration: 20, tpDelay: 1.25 }
    - name: Plant (long)
      kind: debuff
      duration: 10
      behavior: { kind: plant, direction: option, distance: 6.5, radius: 1.7, armDelay: 3, duration: 20, tpDelay: 1.25 }
```

`order` defaults to `"listed"`. Use `"shuffle"` for seeded per-player random order. Use
`"shuffleBalanced"` when the hit list should be split evenly across the possible first effects
(for two effects and eight hit players, four players get each first effect). This changes which
effect lands first, not the combo slot mapping from `optionals.combinations.plant.debuffOrder`.

Behavior fragments represented by `raids/debug/debuff-test.yaml`, `raids/debug/cc-test.yaml`,
`raids/debug/debuff-tower-test.yaml`, and `raids/dancing-mad-ultimate/graven-image-3.yaml`:

```yaml
behavior: { kind: none }
behavior: { kind: vuln, damageType: physical, multiplier: 1.5 }
behavior: { kind: dot, dps: 8, condition: moving }
behavior: { kind: confusion, damage: 50, damageType: "true", radius: 1.5 }
behavior: { kind: sleep }
behavior: { kind: doubleTrouble, radius: 5, damage: 10, damageType: magical, knockbackDistance: 14 }
behavior: { kind: plant, direction: option, distance: 6.5, radius: 1.7, armDelay: 3, duration: 20, tpDelay: 1.25 }
```

- **none** — marker only (no mechanical effect).
- **vuln** — multiplies incoming damage of the matching `damageType` (`physical`/`magical`) by `multiplier` (> 0). Consumed only when a hit deals damage > 0.
- **dot** — deals `dps` damage per second (≥ 0) while active. `condition` gates when a tick deals damage: `"always"` (default) every tick, `"moving"` only while the player acts/moves (formerly `pyretic`), `"idle"` only while the player stays still (formerly `freeze`).
- **confusion** — overrides movement: the player is forced to walk toward whichever other living player was closest **when the debuff landed** (the target is locked at that moment). When they get within `radius` units, that **target** takes `damage` of `damageType` (friendly fire — the confused player takes none) and the debuff ends. Pair with a long `duration` so it lasts until contact.
- **sleep** — disables all input (movement and actions) for the full `duration`. Not broken by taking damage.
- **doubleTrouble** — when the debuff expires, players within `radius` of the carrier take `damage`; everyone hit except the carrier is knocked back `knockbackDistance` from the carrier.
- **plant** — Tele-Trouncing "plant": the HUD shows an arrow along `direction` (`[x, z]`). When the debuff **expires** it places a teleport trap (a `forced_march`) at the player's position. The trap is **inert for `armDelay` seconds** (so the placer can step off), then triggers on contact — the first player to enter its `radius` is frozen for `tpDelay` seconds (the windup), then **instantly teleported** `distance` units along `direction` (measured from their own spot, so it lands purely along the heading). An untriggered trap expires `duration` seconds after it arms. The placed arrow renders via the forced-march layer; nothing is drawn under the player during the debuff. `direction` is a non-zero `[x, z]` vector **or** the string `"option"` (defer to the combination plan — it resolves to a placeholder the plan overrides per player; see [Optional combinations](#optional-combinations)). `radius` defaults `3`, `armDelay` `3`, `duration` `10`, `tpDelay` `0.7`.

## Optional combinations

The optional top-level `optionals` block holds per-mechanic pools that the engine assigns to players
at the start of a run (seeded, so it's reproducible). Currently only **plant** combinations are
supported. Excerpt from `raids/dancing-mad-ultimate/graven-image-3.yaml`:

```yaml
optionals:
  combinations:
    plant:
      rng: true
      debuffOrder: [1, 0]
      g1:
        members: [mt, ot, h1, h2]
        combos:
          - [up, up]
          - [down, down]
          - [left, left]
          - [right, right]
      g2:
        members: [r1, r2, m1, m2]
        combos:
          - [up, right]
          - [right, down]
          - [down, left]
          - [left, up]
```

- Directions are cardinal **constants**: `up` = `[0, 1]` (north), `down` = `[0, -1]`, `left` =
  `[-1, 0]`, `right` = `[1, 0]` (east). Much more readable than raw `[x, z]` vectors.
- A **combo** is one direction per plant slot. By default, plant debuffs use slots in landing order
  (so `["up", "right"]` = first plant heads north, second plant heads east).
- `debuffOrder` optionally maps plant debuff application order to combo slot. For example, `[1, 0]`
  makes the first applied debuff use combo slot 1 and the second applied debuff use combo slot 0,
  which keeps display/solver order separate from each debuff's timer.
- `g1` and `g2` are two **explicit groups**, each with a `members` list (player ids, which must
  exist in the roster) and a `combos` pool. Within a group, the combo pool is shuffled per seed
  before assignment, wrapping if there are fewer combos than members.
- `rng: true` flips a seeded coin each run to **swap** which group's combo pool the two groups draw
  from (so e.g. the `g1` members get `g2`'s headings instead). `rng: false` (the default) is fixed —
  each group uses its own `combos`. A player not listed in any group keeps the `direction` on the
  event's `plant` behavior.
- The assigned headings are stamped onto each player's plant debuffs as they land, **overriding**
  the `direction` written on the `plant` behavior in the event (which then only acts as a fallback
  for raids with no `optionals`). Give each `Tele-Trouncing` plant event a placeholder `direction`
  to satisfy the schema.

## Bot patterns

Bot-controlled players move along waypoint paths. You can inline a `pattern` on a player,
but the convention is a separate file referenced by the raid's `botPatterns` field.

- Name it `<raid>-bots.yaml` so it's excluded from the raid list.
- Set `botPatterns: <raid>-bots` (the id, without extension) on the raid.
Excerpt from `raids/debug/sample-raid-bots.yaml`:

```yaml
players:
  mt:
    - { t: 5, pos: [-12, -8] }
    - { t: 13, pos: [-12, 8] }
    - { t: 20, pos: [-3, 0] }
  h1:
    - { t: 5, pos: [12, -8] }
    - { t: 13, pos: [12, 8] }
    - { t: 20, pos: [3, 0] }
```

Each waypoint is `{ t: <seconds>, pos: [x, z] }`. Only listed players get patterns;
others stay at their spawn (or are driven by a human).
After forced march, plant teleport, or knockback moves a bot, waypoints at or before that forced
movement time are ignored. Add a later waypoint when the bot should resume authored movement.

Bot pattern files can also define runtime bot solvers. Positioning is expressed with the **generic
solver** below: plant arrows via `when.plant`, spread/stack (including its concurrent-`inverse`
"lightning" corridors) via multi-mechanic `when.mechanic`, and debuff dodges like Double Trouble via
`when.debuff` + `role`. See `raids/dancing-mad-ultimate/graven-image-3-bots.yaml` for all three.

`solvers.forsaken` is the one remaining dedicated (non-generic) solver: its spots are computed each
tick from the live assignment plan, tower positions, and active charges, so they can't be expressed
as fixed generic rules. It's configured under `solvers.forsaken` with `towerWindows` / `baitWindows`
(and optional per-window `towerSpots` / `baitSpots` fallbacks); see `forsaken-bots.yaml`.

### Generic solver

The **generic** solver is a data-driven alternative to the bespoke solvers above: instead of new
engine code per mechanic, you write an ordered list of rules under `solvers.generic`. Each tick the
engine builds, for every bot, the set of currently-active mechanics (each as a *resolved id* — the
event id extended with its RNG outcome), the bot's role, and its active debuffs, then walks the rules
in order. The **first** rule whose conditions all match *and* that supplies a spot for that bot wins,
sending it to `spots[<its id>]` (falling back to `spot`). New lookup-style mechanics then need zero
solver code. It is checked before the bespoke solvers, so a generic rule can override them.

A rule has:

- `when` — all conditions are ANDed; a rule must specify at least one of `mechanic` / `debuff` / `plant`:
  - `mechanic` — segment-prefix match on a resolved id (see the suffix table below). Split both on
    `.`; the rule matches if its segments are a prefix of the resolved id's, so `lightning-1` matches
    `lightning-1.inverted.b`, and `lightning-1.inverted` matches only the inverted orientations. The
    rule is active during that mechanic's telegraph→resolve window. Pass an **array** to require
    several mechanics at once — e.g. `mechanic: [fire-1.spread, lightning-1.inverted.a]` only matches
    while a spread_stack resolves to spread *and* a concurrent inverse rolled inverted/variant-a.
  - `role` — `tank` | `healer` | `dps`.
  - `debuff` — an active effect name on the bot; a debuff-only rule is active while that debuff is.
  - `plant` — the bot's assigned plant combo key (e.g. `"right right"`, from `optionals.combinations.plant`);
    active while the bot carries a plant debuff. Add `plantSlot` (0 = short, 1 = long) to target one slot;
    omit it to match either. One `(combo, slot) → spot` rule per placement, e.g.
    `- { when: { plant: right right, plantSlot: 0 }, spot: [0, 12] }`.
- `startAt` / `endAt` — optional absolute time clamps on the activation window.
- `spots` (`playerId -> [x, z]`) and/or `spot` (`[x, z]` for every matching bot); `spots[id]` wins.
  A rule must specify at least one. If a rule matches but supplies no spot for this bot, the search
  falls through to later rules.

Resolved-id suffixes by mechanic kind (RNG outcomes are appended so rules can target a specific roll):

| Mechanic kind | Resolved id |
| --- | --- |
| `aoe`, `tower` (and pending towers) | plain `<id>` (active during its telegraph) |
| `inverse` | `<id>.shown` / `<id>.inverted`, then `.a` / `.b` (rolled variant) — e.g. `lightning-1.inverted.b` |
| `spread_stack` | `<id>.spread` / `<id>.stack` — the **actual** mode (sees through the `?`) |
| `gaze` | `<id>.normal` / `<id>.reverse` |
| `group` | `<id>.g<index>` — the rolled group index from the event's `groups` list |

Excerpt from `raids/debug/rng-stack-bots.yaml` (a `group` mechanic with `groups: [[h1], [h2]]`):

```yaml
solvers:
  generic:
    # Role-conditioned rule first so it overrides the general rule for tanks.
    - when: { mechanic: stack-1.g0, role: tank }
      spot: [-7, 7]
    # General rule: every bot stacks on the rolled group's point.
    - when: { mechanic: stack-1.g0 }
      spot: [-4, 4]
    - when: { mechanic: stack-1.g1 }
      spot: [4, -4]
```

## Worked example

A 45-second arena-wide circle, a baited tankbuster, and a donut, on a circular floor.
Full file: `raids/debug/authoring-demo.yaml`.

```yaml
name: Demo Encounter
arena:
  zones:
    - kind: circle
      center: [0, 0]
      radius: 30
duration: 45

players:
  - id: mt
    role: tank
    spawn: [0, 8]
  - id: ot
    role: tank
    spawn: [0, -8]
  - id: h1
    role: healer
    spawn: [-8, 0]
  - id: h2
    role: healer
    spawn: [8, 0]
  - id: r1
    role: dps
    spawn: [-5.66, 5.66]
  - id: r2
    role: dps
    spawn: [5.66, 5.66]
  - id: m1
    role: dps
    spawn: [-5.66, -5.66]
  - id: m2
    role: dps
    spawn: [5.66, -5.66]

events:
  - id: raidwide
    t: 3
    name: Raidwide
    telegraph: 3
    damage: 30
    damageType: magical
    showCastBar: true
    shape: { kind: circle, center: [0, 0], radius: 30 }

  - type: targeted
    id: tank-buster
    t: 10
    name: Tank Buster
    targetMode: closest
    role: tank
    radius: 4
    telegraph: 3
    damage: 80
    damageType: physical
    showCastBar: true

  - id: shockwave
    t: 18
    name: Shockwave
    telegraph: 4
    damage: 100
    damageType: magical
    shape: { kind: donut, center: [0, 0], inner: 7, outer: 28 }
```

## Validating

The schema runs automatically when the server loads a raid; a bad file throws with a
descriptive Zod error. The existing files in `raids/` double as references: