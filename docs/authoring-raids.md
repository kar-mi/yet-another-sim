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
  (see [Authoring Bot Patterns](authoring-bot-patterns.md)).
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
      center: { x: 0, z: 0 }
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
    time: 3
    name: Single Tower
    pos: { x: 0, z: 12 }
    requiredCount: 1
    failureDamageType: magical
```

| Field         | Required | Notes |
|---------------|----------|-------|
| `name`        | yes      | Display name, non-empty. |
| `arena`       | yes      | `zones: [...]`, at least one zone. Defines the walkable floor. |
| `duration`    | yes      | Encounter length in seconds (> 0). The run ends ("cleared") if players survive this long. |
| `botPatterns` | no       | Id of a bot-pattern file (without extension). See [Authoring Bot Patterns](authoring-bot-patterns.md). |
| `players`     | yes      | Exactly 8, in the canonical roster order below. |
| `events`      | yes      | Array of events. May be empty. |
| `waymarks`    | no       | Optional visual floor markers (A–D, 1–4). See [Waymarks](#waymarks). |
| `boss`        | no       | Optional boss config. See [Boss](#boss). Defaults to Kefka's values when omitted. |

## Boss

The optional `boss:` block controls the boss preset, spawn position, mechanical hitbox, and
floor-ring visuals. Omit it to use the default `kefka` preset. For a single boss, choose a
preset with `boss.id`. For multi-boss raids, each `bosses:` entry uses its slug as the preset
when it matches a registry id; unknown slugs fall back to `kefka`.

| Registry id | Model   | Model scale |
|-------------|---------|-------------|
| `kefka`     | Kefka   | `30` |
| `chaos`     | Chaos   | `20` |
| `exdeath`   | Exdeath | `20` |
| `skeith`    | Skeith  | `1` |

| Field        | Default        | Notes |
|--------------|----------------|-------|
| `id`         | `kefka`        | Single-boss registry id. Valid values are listed above. |
| `pos`        | `{ x: 0, z: 0 }`       | Boss spawn position `{ x, z }`. |
| `model`      | preset value   | Optional model override. |
| `radius`     | preset value   | Mechanical hitbox radius (also scales the floor ring). |
| `ring.scale` | preset value   | Floor-ring radius = `radius * ring.scale`. Larger values make the ring bigger without changing the hitbox. |
| `ring.color` | preset value   | Hex color for the floor ring (e.g. `#3aa0ff` for blue). |

The preset's **model scale is fixed** and cannot be overridden — it's the per-model display
correction the registry exists to own. The `model`, `radius`, and `ring` overrides also apply
to each entry in a multi-boss `bosses:` list.

Example — Chaos with a larger blue ring:

```yaml
boss:
  id: chaos
  radius: 5
  ring:
    scale: 3
    color: "#3aa0ff"
```

## Coordinate system

- The arena is a 2D plane. Positions are `{ x, z }` arrays.
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
      center: { x: 0, z: 0 }
      radius: 12
    - kind: rect
      center: { x: 18, z: 0 }
      width: 8
      height: 20
    - kind: polygon
      vertices:
        - { x: -24, z: -8 }
        - { x: -14, z: -8 }
        - { x: -19, z: 8 }
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
  - { mark: A, pos: { x: 0, z: 16 } }
  - { mark: B, pos: { x: 16, z: 0 } }
  - { mark: "1", pos: { x: 10, z: 10 } }
  - { mark: "2", pos: { x: 10, z: -10 } }
```

| Field  | Required | Notes |
|--------|----------|-------|
| `mark` | yes      | One of `A`, `B`, `C`, `D`, `1`, `2`, `3`, `4`. Each may appear at most once. |
| `pos`  | yes      | `{ x, z }` floor position. |

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
    spawn: { x: -12, z: 12 }
```

| Field     | Required | Notes |
|-----------|----------|-------|
| `id`      | yes      | Must match the roster id for its index. |
| `role`    | yes      | Must match the roster role for its index. |
| `spawn`   | yes      | Starting `{ x, z }`. |
| `pattern` | no       | Inline movement waypoints (see below). Usually supplied via a `-bots` file instead. |

## Events (the timeline)

Every event has a `type` that selects its schema. `type` defaults to `"aoe"` if omitted,
which is why many AOE examples skip it. Supported event types are `aoe`, `targeted`,
`bait`, `tether_source`, `line_link`, `chain`, `group`, `tower`, `effect_resolver`,
`forced_march`, `divebomb`, `effect_burst`, `heal`, `effect_select`, `apply_effect`, `inverse`,
`spread_stack`, `gaze`, `dash`, and `reassign`.

All damaging events share the same lifecycle: the cast begins at `t`, and **resolves** at
`t + telegraph`. Damage and effects are snapshotted at resolve time (FFXIV-style) — a
player's position is only checked the instant the cast resolves, so they can dodge by
leaving the area before then.

### Common fields (aoe & targeted)

| Field           | Required | Notes |
|-----------------|----------|-------|
| `id`            | yes      | Stable mechanic id, unique across the raid file. Links and bot solvers use this value. |
| `time`             | yes      | Cast start time in seconds (≥ 0). |
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
  time: 4
  name: Fireball
  telegraph: 3
  damage: 60
  damageType: magical
  showCastBar: true
  shape: { kind: circle, center: { x: 0, z: 0 }, radius: 9 }
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
  time: 15
  name: Skyward Launch
  telegraph: 3
  damage: 0
  damageType: physical
  showCastBar: true
  shape: { kind: circle, center: { x: 0, z: 0 }, radius: 30 }
  knockback: { distance: 10, height: 9 }
```

| Field      | Required | Notes |
|------------|----------|-------|
| `distance` | yes      | Horizontal push distance in units (> 0). |
| `height`   | no       | Peak arc height (≥ 0). `0` (default) is a flat ground **knockback**; `> 0` makes it a **knockup** that launches the player in an arc and lands them `distance` away. |
| `origin`   | no       | `{ x, z }` point to push away from. Defaults to the shape's center (`circle`/`donut`) or `origin` (`cone`/`rect`). |

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
  time: 3
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
  time: 4
  name: Tail Swipe
  telegraph: 4
  damage: 50
  damageType: physical
  showCastBar: true
  shape: { kind: circle, center: { x: 0, z: 0 }, radius: 20 }
  positional:
    center: 3.14159
    width: 1.5708
```

Because both values are free radians, you can express any wedge: a rear `±45°` cleave
(`center: π, width: π/2`), an intercardinal hit (`center: π/4`), or a half-room cleave in front
of the boss (`center: 0, width: π`). It combines naturally with a boss-anchored `cone`/`rect`.

#### Full-HP check (raidwide)

When `requireFullHp: true` is set on an `aoe`, the shape and position are **ignored**: every
alive player whose `hp < maxHp` at resolve time is hit; players at full HP take nothing.
`maxHp` is per-player (tanks 160, healers/dps 100), so the threshold is always relative to
each player's own maximum.

This is the **G10 White Hole** pattern — use it with high `true` damage to punish un-topped
players. For a raidwide, give the shape a nominal tiny circle (it is unused but required by
the schema):

```yaml
- id: white-hole
  time: 10
  name: White Hole
  telegraph: 5
  damage: 9999
  damageType: "true"
  requireFullHp: true
  showCastBar: true
  shape: { kind: circle, center: { x: 0, z: 0 }, radius: 0.1 }
```

**Heal ordering:** a `heal` event that fires on the same tick as the White Hole resolves
first (the heal pipeline runs before the AOE resolver), so scheduling both on the same tick is
safe — all players are topped before the HP check runs. See also: [Heal / Accretion](#heal--accretion).

| Field          | Required | Notes |
|----------------|----------|-------|
| `requireFullHp`| no       | `true` turns the AOE into a raidwide HP check. Shape is unused. Defaults to `false`. |

### `dash` — blink followed by a landing AOE

A dash holds the boss in place during its windup, shows a landing marker that tracks the current
destination, then instantly moves the boss there. Its required `link` references an earlier
`aoe` with `deferred: true`. After the blink, that AOE gets its own full telegraph before resolving.

Choose one destination form: `to: { x, z }` for a fixed point; `debuff: <name>` for the closest
living carrier of an active effect; or `bait: closest|furthest|random|aggro` with an optional
`role`. Closest, furthest, aggro, and debuff destinations track until cast end. Random selects one
eligible player at cast start and tracks that player.

```yaml
events:
  - type: aoe
    id: landing-hit
    time: 2
    name: Landing Hit
    deferred: true
    anchor: boss
    telegraph: 1.5
    damage: 60
    damageType: physical
    shape: { kind: circle, center: { x: 0, z: 0 }, radius: 6 }

  - type: dash
    id: boss-dash
    time: 5
    name: Boss Dash
    telegraph: 2
    destination: { bait: furthest, role: dps }
    link: landing-hit
    showCastBar: true
```

### `targeted` — near/far baited circle

A circle that snaps onto a player chosen **at resolve time** (not cast start), so players
can reposition during the telegraph. The ground marker stays hidden until it resolves.
Excerpt from `raids/debug/near-far-bait.yaml`:

```yaml
- type: targeted
  id: healer-snipe-furthest
  time: 16
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
  time: 4
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
  time: 10
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
  time: 5
  name: Void Chain
  pos: { x: 0, z: -14 }
  finalizeAfter: 7
  tetherKind: debuff
  buffName: Doom
```

| Field            | Required | Notes |
|------------------|----------|-------|
| `time`              | yes      | When the tether spawns. |
| `name`           | yes      | Mechanic name. |
| `pos`            | yes      | `{ x, z }` anchor position. |
| `finalizeAfter`  | yes      | Seconds until the tether locks in (> 0). |
| `tetherKind`     | yes      | `"buff"` or `"debuff"`. |
| `buffName`       | yes      | Name of the granted effect. |
| `behavior`       | no       | Effect behavior (see [Effects](#effects)). Defaults to `{ kind: none }`. |
| `effectDuration` | no       | Duration of the granted effect in seconds (> 0). Defaults to `15`. |
| `icon`           | no       | HUD icon filename for the granted effect, served from `static/debuffs/`. |

### `line_link` — fixed visual links from an object to selected players

Spawns non-grabbable lines from a source position to selected players. Each target receives
a hidden debuff immediately. The visual lines can disappear before the debuff resolves; at
`t + resolveAfter`, only the stored targets resolve and can receive an effect and/or knockback.
Unlike `tether_source`, these lines do not retarget or get intercepted. Excerpt from
`raids/debug/line-link-test.yaml`:

```yaml
- type: line_link
  id: north-statue
  time: 4
  name: North Statue
  pos: { x: 0, z: 34 }
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
| `time` | yes | When the link spawns. |
| `name` | yes | Mechanic name. |
| `pos` | yes | `{ x, z }` source position. For a north statue, place this outside the arena at positive `z`. |
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
  time: 4
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
| `time` | yes | Cast start time (seconds). |
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
  time: 4
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
| `time` | yes | Cast start time (seconds). The group + marked member are chosen now. |
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
  time: 19
  name: Coin Flip Cross
  telegraph: 5
  damage: 50
  damageType: magical
  showCastBar: true
  rng: true
  ringColor: "#a855f7"
  ringHeight: 3.2
  shownShapes:
    - { kind: cone, origin: { x: 0, z: 0 }, direction: { x: -1, z: 1 }, angleDeg: 80, length: 22 }
    - { kind: cone, origin: { x: 0, z: 0 }, direction: { x: 1, z: -1 }, angleDeg: 80, length: 22 }
  hiddenShapes:
    - { kind: cone, origin: { x: 0, z: 0 }, direction: { x: 1, z: 1 }, angleDeg: 80, length: 22 }
    - { kind: cone, origin: { x: 0, z: 0 }, direction: { x: -1, z: -1 }, angleDeg: 80, length: 22 }
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"inverse"`. |
| `time` | yes | Cast start time (seconds). The inversion is rolled now. |
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
  time: 31
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
| `time` | yes | Cast start time (seconds). The flip + marked member are rolled now. |
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
  time: 3
  name: Evil Eye
  telegraph: 4
  damage: 40
  damageType: magical
  showCastBar: true
  pos: { x: 0, z: 19 }
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"gaze"`. |
| `time` | yes | Cast start time (seconds). The reverse state is rolled now. |
| `name` | yes | Mechanic name (used in the log and cast bar). |
| `telegraph` | yes | Cast duration in seconds (> 0); damage applies at `t + telegraph`. |
| `damage` | yes | Damage (≥ 0) dealt to each hit player. |
| `damageType` | yes | `"physical"`, `"magical"`, or `"true"`. |
| `pos` | yes | `{ x, z }` of the eye board (the thing you face toward/away from). |
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
| `time` | yes | Telegraph start time (seconds). |
| `name` | yes | Mechanic name (used in the log). |
| `telegraph` | yes | Seconds from `t` until it resolves. |
| `pos` | yes | `{ x, z }` center of the tower circle. |
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
  time: 17
  name: Support Tower
  telegraph: 5
  pos: { x: -12, z: 0 }
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

### `divebomb` — stepping circle across the arena

A divebomb is one ground-bisected sphere that appears at `from`, disappears, and reappears at each
successive `gap` position until it reaches `to`, then disappears. Its lifetime is derived from the
path, `gap`, and `speed`. Only players inside the currently visible circle are hit, subject to `hitInterval`. Omitting `damage` and
`applyEffect` makes the event visual-only and does not produce hit-log entries.

| Field | Required | Meaning |
|---|---:|---|
| `type` | yes | `"divebomb"`. |
| `id`, `time`, `name` | yes | Standard event fields. |
| `from`, `to` | yes | Distinct `{ x, z }` endpoints of the corridor. |
| `speed` | yes | Progression speed in world units per second; each step lasts `gap / speed` seconds. |
| `size` | yes | Sphere and active collision-circle diameter. |
| `color` | no | Six-digit hex color; defaults to `#ff5533`. |
| `gap` | no | Distance between successive circle positions; defaults to `size * 1.5`. |
| `damage` | no | Damage per hit. Omitted or zero means no damage. |
| `damageType` | no | `physical`, `magical`, or `true`; defaults to `physical`. |
| `applyEffect` | no | Status effect applied to surviving players on each hit. |
| `hitInterval` | no | Minimum seconds between applications per player; defaults to `gap / speed`. |

```yaml
- type: divebomb
  id: north-south
  time: 3
  name: North-South Divebomb
  from: { x: 0, z: 20 }
  to: { x: 0, z: -20 }
  speed: 30
  size: 3
  color: "#ff5533"
  damage: 40
  damageType: physical
```

See `raids/debug/divebomb-test.yaml` for damaging, visual-only, and effect-applying examples.

### `forced_march` — ground arrow that teleports the first entrant

An armed floor trap drawn as a translucent ring with a direction arrow. The **first** living
player to walk into the zone is instantly teleported `distance` units along `direction`; the trap
is then consumed (it fires once). If no one enters, it expires after `duration`.
Excerpt from `raids/debug/cc-test.yaml`:

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"forced_march"`. |
| `time` | yes | Time the trap arms (seconds, ≥ 0). |
| `name` | yes | Display name (used in the log). |
| `pos` | yes | Center of the trigger zone `{ x, z }`. |
| `radius` | yes | Trigger zone radius (> 0). |
| `direction` | yes | Teleport heading, a non-zero `{ x, z }` vector (magnitude ignored). |
| `distance` | yes | How far the entrant is flung along `direction` (> 0). Beware flinging players off the arena. |
| `duration` | yes | How long the trap stays armed before expiring (> 0). |

```yaml
- type: forced_march
  id: march-n
  time: 4.5
  name: March N
  pos: { x: 0, z: 14 }
  radius: 1.2
  direction: { x: 0, z: 1 }
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
| `time` | yes | Cast start (seconds). Carriers + circle centers are snapshotted now. |
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
  time: 30
  name: Sleeper Burst
  telegraph: 0.5
  effectName: Sleep
  radius: 4
  damage: 40
  damageType: magical
  showCastBar: false
```

### `set_hp` — set players' HP to an absolute value

Sets each targeted living player's HP to `amount` (clamped to their `maxHp`). Used to set up
healer puzzles (e.g. "everyone to 1 HP before applying cleanse debuffs"). Dead players are
unaffected. Targeting mirrors `apply_effect`: all alive by default, narrowed by `role` or `players`.

```yaml
- type: set_hp
  id: seismic-crush
  time: 2
  name: Seismic Crush
  amount: 1
```

| Field     | Required | Notes |
|-----------|----------|-------|
| `time`       | yes      | When HP is set (seconds). |
| `name`    | yes      | Mechanic name (used in the combat log). |
| `amount`  | yes      | Target HP (> 0). Clamped to `maxHp` if it exceeds it. |
| `role`    | no       | Restrict to one role (`tank`/`healer`/`dps`). Ignored if `players` is set. |
| `players` | no       | Explicit list of player ids to target. |

### `heal` — restore all living players

Restores every living player to their own maximum HP immediately at `t`. Dead players stay dead.
Excerpt from `raids/dancing-mad-ultimate/graven-image-3.yaml`:

```yaml
- type: heal
  id: raidwide-heal
  time: 35
  name: Raidwide Heal
```

### `effect_select` — random player debuff

Chooses one group, then one random living member from that group, and applies `applyEffect`
immediately at `t`. With a single group, this is a random member from that group.
Excerpt from `raids/dancing-mad-ultimate/graven-image-3.yaml`:

```yaml
- type: effect_select
  id: double-trouble-support
  time: 0
  name: Double Trouble (Support)
  groups: [[mt, ot, h1, h2]]
  applyEffect:
    name: Double Trouble
    kind: debuff
    duration: 24
    behavior: { kind: burstSpread, radius: 5, damage: 10, damageType: magical, knockbackDistance: 14 }
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
  time: 1
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
| `time`           | yes      | When the effect lands (seconds). |
| `name`        | yes      | Mechanic name (used in the combat log). |
| `role`        | no       | Restrict to one role (`tank`/`healer`/`dps`). Ignored if `players` is set. |
| `players`     | no       | Explicit list of player ids to target. |
| `count`       | no       | Cap the number of targets from the matched pool. |
| `rng`         | no       | `true` picks the `count` targets randomly (seeded); otherwise roster order. |
| `applyEffect` | yes      | The buff/debuff to apply (see [Effects](#effects)). |

### `reassign` — distribute charge debuffs, then re-balance after soaks

Models a "passing charges" mechanic (e.g. FFXIV Forsaken): the opener stamps each player a planned
charge debuff, and after each soak wave the charges are re-balanced back up to target counts onto the
players who just soaked. `charges` maps each named `kind` to its `effect` (and optional above-head
`marker`) spec. The opener (`initial: "plan"`) applies each player's planned kind from
`initialCharges` — the per-player map from [`optionals.combinations.pairings`](#optional-combinations). After
a mechanic whose label appears in `onResolve` resolves a charge (its soakers' debuffs are consumed by
the [tower resolvers](#effect_resolver--tower-triggered-debuff-action) first), the deficit between the
label's target counts and the live counts is dealt onto the just-resolved soakers, in roster order.
Excerpt from `raids/dancing-mad-ultimate/forsaken.yaml`:

```yaml
- type: reassign
  id: forsaken-charges
  time: 3.0
  name: Forsaken Assignment
  initial: plan
  onResolve:
    tower-odd:  { stack: 0, cone: 4, defamation: 4 }   # target counts after an odd-wave soak
    tower-even: { stack: 2, cone: 3, defamation: 3 }   # ... and after an even-wave soak
  charges:
    - kind: stack
      effect: { name: Stack Charge, kind: debuff, duration: 120, visibility: invisible, behavior: { kind: none } }
      marker: { name: Stack Charge Marker, kind: debuff, duration: 5, visibility: invisible, markerIcon: stack_processed.png, behavior: { kind: none } }
    # ... cone, defamation
```

| Field       | Required | Notes |
|-------------|----------|-------|
| `time`         | yes      | When the opener deal lands (seconds). |
| `name`      | yes      | Mechanic name (used in the combat log). |
| `charges`   | yes      | List of `{ kind, effect, marker? }`. `kind` keys both `onResolve` counts and `initialCharges`; `effect.name` must match the charge's `effect_resolver` `effectName`. |
| `initial`   | no       | `"plan"` opens by applying each player's planned charge from `initialCharges`. Omit for an `onResolve`-only event. |
| `onResolve` | no       | Map of trigger label → `{ kind: targetCount }`. When a mechanic with that label resolves a charge, re-balance up to those counts onto the just-resolved players. |

## Shapes

Used by `aoe` events (`shape`) — a point is hit if it falls inside the shape at resolve.
Shape fragments from `raids/debug/sample-raid.yaml`:

```yaml
shape: { kind: circle, center: { x: 0, z: 0 }, radius: 9 }
shape: { kind: donut, center: { x: 0, z: 0 }, inner: 7, outer: 30 }
shape: { kind: cone, origin: { x: 0, z: 0 }, direction: { x: 0, z: 1 }, angleDeg: 90, length: 22 }
shape: { kind: rect, origin: { x: 0, z: 0 }, direction: { x: 1, z: 0 }, width: 6, length: 40 }
```

- **circle** — `radius` > 0. A full-arena circle (radius = arena radius) is an unavoidable raid-wide hit.
- **donut** — safe in the middle: hits between `inner` and `outer`. Requires `inner` < `outer` (`inner` ≥ 0, `outer` > 0).
- **cone** — fans out from `origin` toward `direction` (a non-zero `{ x, z }` vector; magnitude doesn't matter, only heading). `angleDeg` is the full opening angle; `length` is the reach.
- **rect** — a line/lane from `origin` extending along `direction` for `length`, `width` wide (centered on the line).

For `cone`/`rect`, `origin` and `direction` are optional (default `{ x: 0, z: 0 }` / `{ x: 0, z: 1 }`) and can be
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
| `icon`     | no       | HUD icon filename served from `static/debuffs/` (e.g. `"magic-vuln.png"`). Falls back to a generic glyph chosen from the behavior when omitted. |
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
behavior: { kind: burstSpread, radius: 5, damage: 10, damageType: magical, knockbackDistance: 14 }
behavior: { kind: plant, direction: option, distance: 6.5, radius: 1.7, armDelay: 3, duration: 20, tpDelay: 1.25 }
```

- **none** — marker only (no mechanical effect).
- **vuln** — multiplies incoming damage of the matching `damageType` (`physical`/`magical`) by `multiplier` (> 0). Consumed only when a hit deals damage > 0.
- **dot** — deals `dps` damage per second (≥ 0) while active. `condition` gates when a tick deals damage: `"always"` (default) every tick, `"moving"` only while the player acts/moves (formerly `pyretic`), `"idle"` only while the player stays still (formerly `freeze`).
- **confusion** — overrides movement: the player is forced to walk toward whichever other living player was closest **when the debuff landed** (the target is locked at that moment). When they get within `radius` units, that **target** takes `damage` of `damageType` (friendly fire — the confused player takes none) and the debuff ends. Pair with a long `duration` so it lasts until contact.
- **sleep** — disables all input (movement and actions) for the full `duration`. Not broken by taking damage.
- **burstSpread** — when the debuff expires, fires two AOEs in order:
  1. **Self-pop** — a shape centered on the carrier hits all players inside for `damage`; everyone hit except the carrier is knocked back `knockbackDistance` (`0` means no knockback). `selfShape` controls the shape: `"circle"` (default — radius `radius`) or `"donut"` (inner radius `selfInner`, outer radius `radius`; `selfInner` is required and must be less than `radius`).
  2. **Follow-up** (optional) — if `followUp` is set, an AOE is dropped on each of the `count` closest (or furthest, if `mode: "furthest"`) living non-carrier players. By default distance is measured from the carrier; set `originCrystal: fire`, `water`, or `wind` to measure from that resolved elemental crystal instead. `shape`, `radius`, `damage`, `damageType` describe each follow-up circle or donut (`inner` required and < `radius` for donuts). `knockbackDistance` is optional; when omitted no knockback is applied to follow-up hits. A player caught by both the self-pop and a follow-up shape is hit once per shape.

  Entropy/Dynamic Fluid example:
  ```yaml
  # Entropy: circle on self, donut on closest 2
  behavior:
    kind: burstSpread
    selfShape: circle
    radius: 6
    damage: 80
    damageType: magical
    knockbackDistance: 6
    followUp:
      mode: closest
      count: 2
      originCrystal: fire
      shape: donut
      radius: 8
      inner: 3
      damage: 120
      damageType: magical

  # Dynamic Fluid: donut on self, circle on closest 2
  behavior:
    kind: burstSpread
    selfShape: donut
    radius: 8
    selfInner: 3
    damage: 120
    damageType: magical
    knockbackDistance: 6
    followUp:
      mode: closest
      count: 2
      originCrystal: water
      shape: circle
      radius: 6
      damage: 80
      damageType: magical
  ```
- **primordialCrust** — "survive a lethal hit" cleanse mechanic. When a hit would reduce the carrier's HP to 0 or below, the hit instead leaves them at **1 HP** and the debuff is removed (cleansed). If the debuff expires while still on the carrier (uncleansed), it deals `expiryDamage` of `expiryDamageType` — which kills at any HP. `expiryDamageType` defaults to `"true"`.

  > **Note:** The cleanse only fires for discrete mechanic hits routed through `applyMechanicDamage` (AOEs, targeted events, etc.). Continuous DoT ticks in `statusEffects` do not trigger the cleanse — this matches FFXIV's mechanic and is intentional.

  ```yaml
  behavior:
    kind: primordialCrust
    expiryDamage: 999999
    expiryDamageType: "true"
  ```

- **accretion** — "heal to full" cleanse mechanic. The debuff is removed whenever the carrier's HP reaches their maximum HP (i.e. after a `heal` event fires). If the debuff expires while still on the carrier (uncleansed), it deals `expiryDamage` of `expiryDamageType` — which kills at any HP. `expiryDamageType` defaults to `"true"`.

  > **Authoring note:** The cleanse fires on any tick where the carrier is at full HP, not only on the exact tick of a `heal` event. Apply Accretion only **after** reducing the carrier's HP (e.g. via a `set_hp` event), otherwise the debuff self-cleanses on the very next tick.

  ```yaml
  behavior:
    kind: accretion
    expiryDamage: 999999
    expiryDamageType: "true"
  ```

- **assignment** — Generic priority/group marker (e.g. First/Second/Third in Line, Alpha, Beta). Pure HUD marker with no built-in resolution logic. When the debuff expires it deals `expiryDamage` of `expiryDamageType` to the carrier (placeholder until a raid wires up its own mechanic). There is no cleanse path — it always expires. Authors must set `icon` (filename from `/static/debuffs/`) and optionally `marker` for the short HUD label. `expiryDamageType` defaults to `"true"`.

  ```yaml
  behavior:
    kind: assignment
    expiryDamage: 20
    expiryDamageType: "true"
  ```

- **plant** — Tele-Trouncing "plant": the HUD shows an arrow along `direction` (`{ x, z }`). When the debuff **expires** it places a teleport trap (a `forced_march`) at the player's position. The trap is **inert for `armDelay` seconds** (so the placer can step off), then triggers on contact — the first player to enter its `radius` is frozen for `tpDelay` seconds (the windup), then **instantly teleported** `distance` units along `direction` (measured from their own spot, so it lands purely along the heading). An untriggered trap expires `duration` seconds after it arms. The placed arrow renders via the forced-march layer; nothing is drawn under the player during the debuff. `direction` is a non-zero `{ x, z }` vector **or** the string `"option"` (defer to the combination plan — it resolves to a placeholder the plan overrides per player; see [Optional combinations](#optional-combinations)). `radius` defaults `3`, `armDelay` `3`, `duration` `10`, `tpDelay` `0.7`.

## Optional combinations

The optional top-level `optionals` block holds per-mechanic pools that the engine assigns to players
at the start of a run (seeded, so it's reproducible): **plant**, **pairings**, and **endings**
combinations, plus the standalone **`towerRng`** flag (`optionals.towerRng: true` seeds a per-run rotation of tower-wave
positions around their canonical ring). Excerpt from `raids/dancing-mad-ultimate/graven-image-3.yaml`:

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

- Directions are cardinal **constants**: `up` = `{ x: 0, z: 1 }` (north), `down` = `{ x: 0, z: -1 }`, `left` =
  `{ x: -1, z: 0 }`, `right` = `{ x: 1, z: 0 }` (east). Much more readable than raw `{ x, z }` vectors.
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

### `pairings`

Pairs players into duos and (optionally) labels each pair's group + initial charges. It populates the
generic `world.partners` (paired player, for bot-solver `when.partnerDebuff`), `world.playerGroups`
(for `when.soaks` vs a mechanic's `group`), and `world.initialCharges` (the [`reassign`](#reassign--distribute-charge-debuffs-then-re-balance-after-soaks)
opener). Excerpt from `raids/dancing-mad-ultimate/forsaken.yaml`:

```yaml
optionals:
  combinations:
    pairings:
      rng: true
      patterns:
        - id: baseline
          pairs:
            - { members: [h1, mt], group: A, charges: [stack, defamation] }
            - { members: [h2, ot], group: B, charges: [cone, cone] }
            # ... one pair per duo
        - id: alternate
          pairs: [ ... ]   # an alternative pairing/charge layout
```

- A **pattern** is one full pairing layout. `rng: true` picks a pattern at random per run (seeded);
  `rng: false` (default) always uses the first.
- Each **pair** has `members: [a, b]` (required) plus optional `group` (any label string, matched
  against tower/mechanic `group` fields) and `charges: [kindA, kindB]` (the charge kind each member
  carries — must match a `kind` in the consuming `reassign` event's `charges`).
- Validation: a player may appear in at most one pair per pattern, and all ids must exist in the
  roster. A pattern may cover a subset of the roster — unlisted players simply get no pairing.

### `endings`

Assigns `directionOffset` values to stored deferred AoEs at world creation. `events` lists the
deferred AoE ids, `offsets` lists the candidate offsets, and `rng: true` shuffles the offsets per
seed before zipping them onto the events; `rng: false` uses the listed order. The selected values are
stored in `world.endingOffsets` for bot-solver `when.endingFacing`.

## Bot patterns

Bot-controlled players are driven by a separate `<raid>-bots.yaml` file: static waypoint paths and/or
data-driven `solvers.generic` rules that react to live mechanics. Set `botPatterns: <raid>-bots` (the
id, without extension) on the raid to attach it. The full reference — waypoints, the generic solver,
resolved-id suffixes, and rotated `frame` spots — lives in [Authoring Bot Patterns](authoring-bot-patterns.md).

## Worked example

A 45-second arena-wide circle, a baited tankbuster, and a donut, on a circular floor.
Full file: `raids/debug/authoring-demo.yaml`.

```yaml
name: Demo Encounter
arena:
  zones:
    - kind: circle
      center: { x: 0, z: 0 }
      radius: 30
duration: 45

players:
  - id: mt
    role: tank
    spawn: { x: 0, z: 8 }
  - id: ot
    role: tank
    spawn: { x: 0, z: -8 }
  - id: h1
    role: healer
    spawn: { x: -8, z: 0 }
  - id: h2
    role: healer
    spawn: { x: 8, z: 0 }
  - id: r1
    role: dps
    spawn: { x: -5.66, z: 5.66 }
  - id: r2
    role: dps
    spawn: { x: 5.66, z: 5.66 }
  - id: m1
    role: dps
    spawn: { x: -5.66, z: -5.66 }
  - id: m2
    role: dps
    spawn: { x: 5.66, z: -5.66 }

events:
  - id: raidwide
    time: 3
    name: Raidwide
    telegraph: 3
    damage: 30
    damageType: magical
    showCastBar: true
    shape: { kind: circle, center: { x: 0, z: 0 }, radius: 30 }

  - type: targeted
    id: tank-buster
    time: 10
    name: Tank Buster
    targetMode: closest
    role: tank
    radius: 4
    telegraph: 3
    damage: 80
    damageType: physical
    showCastBar: true

  - id: shockwave
    time: 18
    name: Shockwave
    telegraph: 4
    damage: 100
    damageType: magical
    shape: { kind: donut, center: { x: 0, z: 0 }, inner: 7, outer: 28 }
```

## Validating

The schema runs automatically when the server loads a raid; a bad file throws with a
descriptive Zod error. The existing files in `raids/` double as references:
