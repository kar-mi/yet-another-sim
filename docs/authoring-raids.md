# Authoring Raid JSON

Raids are plain JSON files in the `raids/` directory. Each file describes an arena, a
fixed roster of 8 players, and a timeline of events (mechanics) that resolve over time.
The server validates every file against a strict schema (`src/engine/raidSchema.ts`) on
load — an invalid file throws and the raid won't start.

## File location & naming

- Put raid files in `raids/<id>.json`.
- `<id>` is the filename without extension and must match `^[a-z0-9][a-z0-9-]{0,63}$`
  (lowercase letters, digits, hyphens; can't start with a hyphen). It's the id used in the
  raid list and join URLs.
- The server lists all `raids/*.json` via `/api/raids`, **except** files ending in
  `-bots.json` — those are treated as bot-movement pattern files (see [Bot patterns](#bot-patterns)).

## Top-level shape

```json
{
  "name": "Sample Raid",
  "arena": { "zones": [{ "kind": "circle", "center": [0, 0], "radius": 38 }] },
  "duration": 45,
  "botPatterns": "sample-raid-bots",
  "players": [ /* exactly 8, see Roster */ ],
  "events": [ /* timeline, see Events */ ],
  "waymarks": [ /* optional, see Waymarks */ ]
}
```

| Field         | Required | Notes |
|---------------|----------|-------|
| `name`        | yes      | Display name, non-empty. |
| `arena`       | yes      | `{ "zones": [...] }`, at least one zone. Defines the walkable floor. |
| `duration`    | yes      | Encounter length in seconds (> 0). The run ends ("cleared") if players survive this long. |
| `botPatterns` | no       | Id of a bot-pattern file (without `.json`). See [Bot patterns](#bot-patterns). |
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
zones to build non-circular arenas.

```json
{ "kind": "circle",  "center": [0, 0], "radius": 38 }
{ "kind": "rect",    "center": [0, 0], "width": 40, "height": 20 }
{ "kind": "polygon", "vertices": [[-10, -10], [10, -10], [0, 12]] }
```

- `circle`: `radius` > 0.
- `rect`: axis-aligned, `width`/`height` > 0, centered on `center`.
- `polygon`: at least 3 `vertices`.

## Waymarks

`waymarks` is an optional list of fixed reference markers drawn on the floor — the
A–D / 1–4 spots raiders position around. They are **purely visual**: they have no
collision and never affect damage, targeting, or simulation.

```json
"waymarks": [
  { "mark": "A", "pos": [0, 16] },
  { "mark": "1", "pos": [10, 10] }
]
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

Each player entry:

```json
{ "id": "mt", "role": "tank", "control": "bot", "spawn": [-12, 12] }
```

| Field     | Required | Notes |
|-----------|----------|-------|
| `id`      | yes      | Must match the roster id for its index. |
| `role`    | yes      | Must match the roster role for its index. |
| `spawn`   | yes      | Starting `[x, z]`. |
| `control` | no       | `"human"` (default) or `"bot"`. Humans are driven by connected players; bots follow patterns. |
| `pattern` | no       | Inline movement waypoints (see below). Usually supplied via a `-bots.json` file instead. |

## Events (the timeline)

Every event has a `type` that selects its schema. `type` defaults to `"aoe"` if omitted,
which is why most examples skip it. The types are `aoe`, `targeted`, `tether_source`,
`chain`, `group`, and `tower`.

All damaging events share the same lifecycle: the cast begins at `t`, and **resolves** at
`t + telegraph`. Damage and effects are snapshotted at resolve time (FFXIV-style) — a
player's position is only checked the instant the cast resolves, so they can dodge by
leaving the area before then.

### Common fields (aoe & targeted)

| Field           | Required | Notes |
|-----------------|----------|-------|
| `t`             | yes      | Cast start time in seconds (≥ 0). |
| `name`          | yes      | Mechanic name (shown on the cast bar). |
| `telegraph`     | yes      | Cast duration in seconds (> 0). |
| `damage`        | yes      | Damage applied on hit (≥ 0; use `0` for effect-only mechanics). |
| `damageType`    | yes      | `"physical"`, `"magical"`, or `"true"`. `true` ignores vulnerability multipliers. |
| `applyEffect`   | no       | Buff/debuff applied to those hit (see [Effects](#effects)). |
| `showCastBar`   | no       | `true` shows the on-screen cast bar with name + timer. Defaults to `false`. |
| `showTelegraph` | no       | `true` (default) draws the ground marker. Set `false` for an **invisible** AOE — cast bar and damage still apply, but no floor circle is drawn. |

### `aoe` — fixed-shape area

The classic mechanic: a shape on the ground that hits whoever stands in it at resolve.

```json
{
  "t": 4,
  "name": "Fireball",
  "telegraph": 3,
  "damage": 60,
  "damageType": "magical",
  "showCastBar": true,
  "shape": { "kind": "circle", "center": [0, 0], "radius": 9 }
}
```

The `shape` is required. See [Shapes](#shapes).

#### Knockback / knockup

An `aoe` event may carry an optional `knockback` that **displaces** every player caught in
the shape at resolve, pushing them directly **away from an origin** (direction is
`player − origin`). It composes with `damage`/`applyEffect` and works with `damage: 0` for a
pure shove. While being displaced a player's own movement input is ignored, so they travel
the full distance.

```json
{
  "t": 6,
  "name": "Shockwave",
  "telegraph": 3,
  "damage": 0,
  "damageType": "physical",
  "shape": { "kind": "circle", "center": [0, 0], "radius": 40 },
  "knockback": { "distance": 14, "height": 6 }
}
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

When you use these, the shape's own `origin`/`direction` may be omitted (they default and are
overridden). Each flag is independent — e.g. `anchor: "boss"` with a static shape `direction` vector
gives a fixed-heading cleave that originates from the boss.

Express a directional cleave with the `cone`'s `angleDeg` (full width) plus `directionOffset`:
a front 90° cleave is `angleDeg: 90` with no offset; a rear cleave adds `directionOffset: 3.14159`
(π); a left half-room cleave is `angleDeg: 180, directionOffset: -1.5708` (−π/2). See
`raids/positional-test.json`.

```json
{
  "t": 8,
  "name": "Cleave",
  "telegraph": 4,
  "damage": 80,
  "damageType": "physical",
  "anchor": "boss",
  "directionFrom": "bossFacing",
  "shape": { "kind": "cone", "angleDeg": 90, "length": 22 }
}
```

#### Positionals (`positional`)

Gate a directional attack to an **arc relative to the boss's facing**, defined in radians. A
player is hit only if they are both inside the `shape` **and** within the arc — everyone else is
spared. Omit it for a normal (omnidirectional) hit.

| Field    | Required | Notes |
|----------|----------|-------|
| `center` | yes      | Arc center in radians, measured **clockwise from the boss's facing**. `0` = front, `π` = rear, `π/2` = the boss's right, `-π/2` = left, `π/4` = front-right intercardinal, etc. |
| `width`  | yes      | Full angular width of the arc in radians (so the arc spans `center ± width/2`). E.g. `π/2` is a ±45° wedge; `π` is a 180° half cleave; `2π` covers everything. |

```json
{
  "t": 8,
  "name": "Tail Swipe",
  "telegraph": 4,
  "damage": 50,
  "damageType": "physical",
  "shape": { "kind": "circle", "center": [0, 0], "radius": 20 },
  "positional": { "center": 3.14159, "width": 1.5708 }
}
```

Because both values are free radians, you can express any wedge: a rear `±45°` cleave
(`center: π, width: π/2`), an intercardinal hit (`center: π/4`), or a half-room cleave in front
of the boss (`center: 0, width: π`). It combines naturally with a boss-anchored `cone`/`rect`.

### `targeted` — near/far baited circle

A circle that snaps onto a player chosen **at resolve time** (not cast start), so players
can reposition during the telegraph. The ground marker stays hidden until it resolves.

```json
{
  "type": "targeted",
  "t": 4,
  "name": "Near Bait",
  "targetMode": "closest",
  "role": "healer",
  "radius": 5,
  "telegraph": 3,
  "damage": 50,
  "damageType": "magical",
  "showCastBar": true
}
```

| Field        | Required | Notes |
|--------------|----------|-------|
| `targetMode` | yes      | `"closest"` or `"furthest"` (measured from arena center). |
| `role`       | no       | If set (`tank`/`healer`/`dps`), only that role is eligible to be the target. |
| `radius`     | yes      | Circle radius (> 0). |
| plus all [common fields](#common-fields-aoe--targeted) except `shape`. | | |

### `tether_source` — buff/debuff tether

Spawns a tether anchor at a point. The nearest player gets tethered; when it finalizes
after `finalizeAfter` seconds, the effect is granted (or, for a debuff, applied unless
intercepted). See `raids/tether-test.json`.

```json
{
  "type": "tether_source",
  "t": 5,
  "name": "Void Chain",
  "pos": [0, -14],
  "finalizeAfter": 7,
  "tetherKind": "debuff",
  "buffName": "Doom",
  "behavior": { "kind": "none" },
  "effectDuration": 15
}
```

| Field            | Required | Notes |
|------------------|----------|-------|
| `t`              | yes      | When the tether spawns. |
| `name`           | yes      | Mechanic name. |
| `pos`            | yes      | `[x, z]` anchor position. |
| `finalizeAfter`  | yes      | Seconds until the tether locks in (> 0). |
| `tetherKind`     | yes      | `"buff"` or `"debuff"`. |
| `buffName`       | yes      | Name of the granted effect. |
| `behavior`       | no       | Effect behavior (see [Effects](#effects)). Defaults to `{ "kind": "none" }`. |
| `effectDuration` | no       | Duration of the granted effect in seconds (> 0). Defaults to `15`. |

### `line_link` — fixed visual links from an object to selected players

Spawns non-grabbable lines from a source position to selected players. Each target receives
a hidden debuff immediately. The visual lines can disappear before the debuff resolves; at
`t + resolveAfter`, only the stored targets resolve and can receive an effect and/or knockback.
Unlike `tether_source`, these lines do not retarget or get intercepted.

```json
{
  "type": "line_link",
  "t": 5,
  "name": "North Statue",
  "pos": [0, 22],
  "linkDuration": 1.5,
  "resolveAfter": 6,
  "target": { "roles": ["tank", "healer"], "count": 4, "mode": "closest" },
  "hiddenDebuffName": "Line Linked",
  "applyEffect": {
    "name": "Magic Vulnerability",
    "kind": "debuff",
    "duration": 8,
    "behavior": { "kind": "vuln", "damageType": "magical", "multiplier": 1.5 }
  },
  "knockback": { "distance": 12 },
  "visual": { "kind": "statue", "width": 3, "height": 5, "depth": 1 }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `"line_link"`. |
| `t` | yes | When the link spawns. |
| `name` | yes | Mechanic name. |
| `pos` | yes | `[x, z]` source position. For a north statue, place this outside the arena at positive `z`. |
| `resolveAfter` | yes | Seconds until the link resolves (> 0). |
| `linkDuration` | no | Seconds the visual lines remain before disappearing. Defaults to `resolveAfter`. |
| `target` | no | `mode` (`"closest"`/`"furthest"`), `roles`, `playerIds`, and/or `count`. If both `roles` and `playerIds` are set, both filters must match. Defaults to closest alive player. |
| `target.count` | no | Number of eligible targets selected. Defaults to `1`, or to `playerIds.length` when `playerIds` is supplied. |
| `hiddenDebuffName` | yes | Name of the hidden simulation debuff applied while the line is active. It does not show in the HUD. |
| `applyEffect` | no | Visible buff/debuff applied to the linked player at resolve. |
| `knockback` | no | Knockback applied to each stored target at resolve; defaults to origin `pos` unless `knockback.origin` is set. |
| `visual` | no | `{ "kind": "statue" }` draws a rectangular statue at `pos`; dimensions default if omitted. |

### `chain` — break-apart pair chains

Chains a set of **explicitly named player pairs** together. While the cast bar counts down
(for `telegraph` seconds) a chain icon floats over each chained player's head. At cast end a
`debuffName` debuff is applied to both members and a line connects them. Each pair then has
`breakWindow` seconds to **increase their separation by `breakDistance`**: the threshold is the
pair's distance when the chain connects *plus* `breakDistance` (e.g. starting 5 apart with
`breakDistance: 6` breaks at 11; starting on top of each other breaks at 6). Breaking removes
the debuff (no damage). Any pair still chained when the window closes takes a single
burst of `breakDamage` (vulnerabilities apply per the pair's `damageType`). See
`raids/chain-test.json`.

```json
{
  "type": "chain",
  "t": 4,
  "name": "Binding Chains",
  "pairs": [["mt", "h1"], ["ot", "h2"]],
  "telegraph": 4,
  "breakWindow": 6,
  "breakDistance": 12,
  "breakDamage": 40,
  "damageType": "magical",
  "debuffName": "Chain Bond",
  "showCastBar": true
}
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
  `group` event ("repeat with the opposite group"). The linked source must set an explicit `id`,
  occur at an earlier `t`, and both events must have **exactly two** groups.

```json
{
  "type": "group",
  "id": "stack-1",
  "t": 4,
  "name": "Shared Sentence",
  "rng": true,
  "groups": [["h1"], ["h2"]],
  "telegraph": 5,
  "radius": 6,
  "requiredCount": 4,
  "damage": 200,
  "damageType": "magical",
  "showCastBar": true
}
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
| `id` | no | Event id; required only if another event `link`s to it. |
| `rng` | no | Pick a random group instead of the first. Default `false`. |
| `link` | no | Id of an earlier `group` event whose complementary group to take (both must have 2 groups). |
| `applyEffect` | no | Debuff/buff applied to each hit soaker (same shape as on `aoe`). |
| `showCastBar` | no | Show the cast bar during the telegraph. Default `false`. |

See `raids/rng-stack.json` for a linked pair demonstrating opposite-group assignment.

### `tower` — soak circle

A `tower` is a flat circle on the floor that players must stand in ("soak") before it
resolves. At resolve time (`t + telegraph`) the engine counts the **valid soakers** inside:

- If there are fewer than `requiredCount` valid soakers, the tower **fails** and the whole
  raid takes `failureDamage` (raidwide, applied flat — vulnerabilities do not amplify it).
- If it succeeds, each valid soaker optionally receives `applyEffect` and/or `knockback`.
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
| `visual` | no | Floor/marker visuals (see below). |

The optional `visual` object controls how the tower is drawn (the flat disk + ring is always
shown):

| Field | Notes |
|-------|-------|
| `pillar` | `true` draws a static column in the center. |
| `countCircles` | `true` draws one small floor circle per `requiredCount`, filling as players step in. |
| `fallingCylinder` | `true` draws a long thin cylinder that descends in time with the cast and reaches the floor at resolve. |
| `groundStyle` | `"standard"` (yellow inner line, red outer edge) or `"tank"` (two red lines). Defaults to `"standard"`. |
| `cylinderColor` | Hex string (e.g. `"#33ccff"`) for the falling cylinder. Defaults to cyan. |
| `cylinderThickness` | Diameter of the falling cylinder (> 0). Defaults to a value scaled from the tower radius. |

```json
{
  "type": "tower",
  "t": 17,
  "name": "Support Tower",
  "telegraph": 5,
  "pos": [-12, 0],
  "radius": 3,
  "requiredRoles": ["tank", "healer"],
  "wrongRoleLethal": true,
  "failureDamage": 40,
  "failureDamageType": "magical",
  "applyEffect": {
    "name": "Magic Vulnerability",
    "kind": "debuff",
    "duration": 8,
    "behavior": { "kind": "vuln", "damageType": "magical", "multiplier": 1.5 }
  },
  "knockback": { "distance": 8 },
  "visual": { "fallingCylinder": true, "pillar": true, "groundStyle": "tank", "cylinderColor": "#cc66ff" }
}
```

See `raids/tower-test.json` for a full example with single, multi-soak, and support towers.

## Shapes

Used by `aoe` events (`shape`) — a point is hit if it falls inside the shape at resolve.

```json
{ "kind": "circle", "center": [0, 0], "radius": 9 }
{ "kind": "donut",  "center": [0, 0], "inner": 7, "outer": 30 }
{ "kind": "cone",   "origin": [0, 0], "direction": [0, 1], "angleDeg": 90, "length": 22 }
{ "kind": "rect",   "origin": [0, 0], "direction": [1, 0], "width": 6,  "length": 40 }
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
`applyEffect` wraps it with metadata:

```json
"applyEffect": {
  "name": "Magic Vulnerability Up",
  "kind": "debuff",
  "duration": 10,
  "visibility": "visible",
  "behavior": { "kind": "vuln", "damageType": "magical", "multiplier": 2 }
}
```

| Field      | Required | Notes |
|------------|----------|-------|
| `name`     | yes      | Display name. |
| `kind`     | yes      | `"buff"` or `"debuff"`. |
| `duration` | yes      | Seconds the effect lasts (> 0). |
| `visibility` | no    | `"visible"` (default) shows in the HUD; `"invisible"` stores the effect without a HUD chip. |
| `behavior` | yes      | One of the behaviors below. |

Behaviors:

```json
{ "kind": "none" }
{ "kind": "vuln", "damageType": "magical", "multiplier": 2 }
{ "kind": "pyretic", "dps": 8 }
{ "kind": "freeze",  "dps": 8 }
```

- **none** — marker only (no mechanical effect).
- **vuln** — multiplies incoming damage of the matching `damageType` (`physical`/`magical`) by `multiplier` (> 0). Consumed only when a hit deals damage > 0.
- **pyretic** — deals `dps` damage per second (≥ 0) while active.
- **freeze** — deals `dps` damage per second (≥ 0) while active.

## Bot patterns

Bot-controlled players move along waypoint paths. You can inline a `pattern` on a player,
but the convention is a separate file referenced by the raid's `botPatterns` field.

- Name it `<raid>-bots.json` so it's excluded from the raid list.
- Set `"botPatterns": "<raid>-bots"` (the id, without `.json`) on the raid.

```json
{
  "players": {
    "mt": [
      { "t": 5,  "pos": [-12, -8] },
      { "t": 13, "pos": [-12, 8] },
      { "t": 20, "pos": [-3, 0] }
    ],
    "h1": [
      { "t": 5,  "pos": [12, -8] }
    ]
  }
}
```

Each waypoint is `{ "t": <seconds>, "pos": [x, z] }`. Only listed players get patterns;
others stay at their spawn (or are driven by a human).

## Worked example

A 45-second arena-wide circle, a baited tankbuster, and a donut, on a circular floor:

```json
{
  "name": "Demo Encounter",
  "arena": { "zones": [{ "kind": "circle", "center": [0, 0], "radius": 30 }] },
  "duration": 45,
  "players": [
    { "id": "mt", "role": "tank",   "control": "bot", "spawn": [0, 8] },
    { "id": "ot", "role": "tank",   "control": "bot", "spawn": [0, -8] },
    { "id": "h1", "role": "healer", "control": "bot", "spawn": [-8, 0] },
    { "id": "h2", "role": "healer", "control": "bot", "spawn": [8, 0] },
    { "id": "r1", "role": "dps",    "control": "bot", "spawn": [-5.66, 5.66] },
    { "id": "r2", "role": "dps",    "control": "bot", "spawn": [5.66, 5.66] },
    { "id": "m1", "role": "dps",    "control": "human", "spawn": [-5.66, -5.66] },
    { "id": "m2", "role": "dps",    "control": "bot", "spawn": [5.66, -5.66] }
  ],
  "events": [
    {
      "t": 3, "name": "Raidwide", "telegraph": 3, "damage": 30, "damageType": "magical",
      "showCastBar": true,
      "shape": { "kind": "circle", "center": [0, 0], "radius": 30 }
    },
    {
      "type": "targeted", "t": 10, "name": "Tank Buster", "targetMode": "closest",
      "role": "tank", "radius": 4, "telegraph": 3, "damage": 80, "damageType": "physical",
      "showCastBar": true
    },
    {
      "t": 18, "name": "Shockwave", "telegraph": 4, "damage": 100, "damageType": "magical",
      "shape": { "kind": "donut", "center": [0, 0], "inner": 7, "outer": 28 }
    }
  ]
}
```

## Validating

The schema runs automatically when the server loads a raid; a bad file throws with a
descriptive Zod error. The existing files in `raids/` double as references:

- `sample-raid.json` — every shape kind (`circle`, `cone`, `rect`, `donut`).
- `near-far-bait.json` — `targeted` events with `role` filters and `applyEffect`.
- `debuff-test.json` — `vuln`, `pyretic`, and `freeze` behaviors.
- `tether-test.json` — `tether_source` buff and debuff.
- `line-link-test.json` — `line_link` from a north statue with hidden debuff, effect, and knockback.
- `chain-test.json` — `chain` break-apart pairs with a debuff and burst.
- `rng-stack.json` — `group` random shared-stack assignment with a linked opposite-group repeat.
