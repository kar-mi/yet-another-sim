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
which is why most examples skip it. The three types are `aoe`, `targeted`, and
`tether_source`.

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

## Effects

`applyEffect` (on aoe/targeted) and `tether_source.behavior` use the same behavior union.
`applyEffect` wraps it with metadata:

```json
"applyEffect": {
  "name": "Magic Vulnerability Up",
  "kind": "debuff",
  "duration": 10,
  "behavior": { "kind": "vuln", "damageType": "magical", "multiplier": 2 }
}
```

| Field      | Required | Notes |
|------------|----------|-------|
| `name`     | yes      | Display name. |
| `kind`     | yes      | `"buff"` or `"debuff"`. |
| `duration` | yes      | Seconds the effect lasts (> 0). |
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
