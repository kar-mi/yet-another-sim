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
  "events": [ /* timeline, see Events */ ]
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
