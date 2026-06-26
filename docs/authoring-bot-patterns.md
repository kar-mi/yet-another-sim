# Authoring Bot Patterns

Bot patterns drive the non-human players in a raid: where they stand, when they move, and how
they react to mechanics. They live alongside the raid file and are referenced by the raid's
`botPatterns` field. For the raid timeline itself (events, shapes, effects), see
[Authoring Raids](authoring-raids.md).

A bot pattern file has two parts, either of which may be omitted:

- **`players`** — static waypoint paths (move to a position at a time).
- **`solvers.generic`** — data-driven rules that react to live mechanics each tick.

## File location & naming

Bot-controlled players move along waypoint paths. You can inline a `pattern` on a player in the raid
file, but the convention is a separate file referenced by the raid's `botPatterns` field.

- Name it `<raid>-bots.yaml` so it's excluded from the raid list.
- Set `botPatterns: <raid>-bots` (the id, without extension) on the raid.

## Waypoint patterns

Excerpt from `raids/debug/sample-raid-bots.yaml`:

```yaml
players:
  mt:
    - { time: 5, pos: { x: -12, z: -8 } }
    - { time: 13, pos: { x: -12, z: 8 } }
    - { time: 20, pos: { x: -3, z: 0 } }
  h1:
    - { time: 5, pos: { x: 12, z: -8 } }
    - { time: 13, pos: { x: 12, z: 8 } }
    - { time: 20, pos: { x: 3, z: 0 } }
```

Each waypoint is `{ time: <seconds>, pos: { x, z } }`. Only listed players get patterns;
others stay at their spawn (or are driven by a human).
After forced march, plant teleport, or knockback moves a bot, waypoints at or before that forced
movement time are ignored. Add a later waypoint when the bot should resume authored movement.

Bot pattern files define runtime bot solvers entirely through the **generic solver** below: plant
arrows via `when.plant`, spread/stack (including its concurrent-`inverse` "lightning" corridors) via
multi-mechanic `when.mechanic`, and debuff dodges like Double Trouble via `when.debuff` + `role`. See
`raids/dancing-mad-ultimate/graven-image-3-bots.yaml` for all three.

Even rotating, state-dependent fights are expressible: `forsaken-bots.yaml` solves all eight of
Forsaken's 45°-rotating tower waves and the four stored-cone ending baits with ~24 generic rules,
using event `labels`/`group`, `when.soaks` / `when.partnerDebuff`, and rotated-frame spots (see below).

## Generic solver

The **generic** solver is a data-driven bot solver: instead of new engine code per mechanic, you
write an ordered list of rules under `solvers.generic`. Each tick the engine builds, for every bot,
the set of currently-active mechanics (each as a *resolved id* — the event id extended with its RNG
outcome), the bot's role, and its active debuffs, then walks the rules in order. The **first** rule
whose conditions all match *and* that supplies a spot for that bot wins, sending it to
`spots[<its id>]` (falling back to `spot`). New lookup-style mechanics then need zero solver code.
When no rule matches, the bot falls back to its authored waypoints.

A rule has:

- `when` — all conditions are ANDed; a rule must specify `static: true` or at least one of
  `mechanic` / `debuff` / `partnerDebuff` / `plant`:
  - `static: true` — always active, subject to `startAt` / `endAt` and any other conditions. Put a
    static rule last to provide default positions when no mechanic-specific rule matches. An empty
    `when: {}` is rejected so an accidentally incomplete rule cannot become a catch-all.
  - `mechanic` — segment-prefix match on a resolved id (see the suffix table below) **or** an exact
    match against one of the mechanic's authored `labels`. Split both on `.`; the rule matches if its
    segments are a prefix of the resolved id's, so `lightning-1` matches `lightning-1.inverted.b`, and
    `lightning-1.inverted` matches only the inverted orientations. The rule is active during that
    mechanic's telegraph→resolve window. Pass an **array** to require several mechanics at once — e.g.
    `mechanic: [fire-1.spread, lightning-1.inverted.a]` only matches while a spread_stack resolves to
    spread *and* a concurrent inverse rolled inverted/variant-a.
  - `role` — `tank` | `healer` | `dps`.
  - `debuff` — an active effect name on the bot (or an **array** requiring all listed names). A
    debuff-only rule is active while that debuff is.
  - `partnerDebuff` — same matching, against the bot's partner (`world.partners`, populated e.g. from a
    Forsaken pair plan). Lets one bot's spot depend on its partner's assignment.
  - `soaks` — `true`/`false`, compared against the group of the first live mechanic matched by
    `when.mechanic` (which is required). `true` matches bots whose group (`world.playerGroups`) equals
    the mechanic's `group`; `false` matches bots whose group differs (and the mechanic has a group).
  - `plant` — the bot's assigned plant combo key (e.g. `"right right"`, from `optionals.combinations.plant`);
    active while the bot carries a plant debuff. Add `plantSlot` (0 = short, 1 = long) to target one slot;
    omit it to match either. One `(combo, slot) → spot` rule per placement, e.g.
    `- { when: { plant: right right, plantSlot: 0 }, spot: { x: 0, z: 12 } }`.
  - `endingFacing` — `{ event, offset }`, matched against `world.endingOffsets[event] === offset` for seeded stored-ending directions.
- `startAt` / `endAt` — optional absolute time clamps on the activation window.
- `frame` — optional rotated coordinate frame for the spot(s). It is either `"matched"` or a **list of
  references** whose positions are summed and normalized to set north. If a reference list contains
  `{ boss: { from: facing } }`, that facing direction sets north directly instead; the other
  references in the same list affect only `mirrorLateral` handedness. `"matched"` sets north to the
  bisector of the live matched mechanics' positions (e.g. a wave's two towers — requires
  `when.mechanic`). Each reference in the list is one of: an **event id** (a positioned event such as a
  tower, using its **static** position); `{ crystal: wind }` (or `fire` / `water`, the resolved
  elemental crystal); `{ boss: { from: facing } }` (the primary boss's facing direction) or
  `{ boss: { from: position, id: add } }` (from arena centre toward a named boss — `id` defaults to the
  primary boss). Kinds may be mixed in one list, e.g. `frame: [{ boss: { from: position } }, { crystal: wind }]`
  points north toward the midpoint of the boss and the wind crystal; `frame: [tower-3-left, tower-3-right]`
  is the towers' bisector. A frame coordinate `{ r, z }` maps to world `r · right + z · north`, with
  `right = { x: north.z, z: -north.x }` and the arena centre as origin. Polar `{ dist, angleDeg }` is
  also accepted, with degrees measured clockwise from frame north. One spot set then serves every wave
  of a rotating mechanic. A rule whose frame can't be computed yields no spot (falls through). See
  [Rotated frames](#rotated-frames) for the geometry.
- `mirrorLateral` — optional for a reference-list frame that includes `{ boss: { from: facing } }`.
  When `true`, the frame's lateral axis flips if the other references lie on the boss's left. Use it
  when opposite crystal configurations should mirror the same authored `{ r, z }` spot rather than
  merely rotate it. Those other references decide only the left/right handedness; they do not rotate
  north when boss facing is present.
- `spots` and/or `spot`; `spots[id]` wins. Unframed rules use absolute world positions `{ x, z }`.
  Framed rules require relative `{ r, z }` or polar `{ dist, angleDeg }` positions. Polar spots are
  rejected on unframed rules.
  A rule must specify at least one. If a rule matches but supplies no spot for this bot, the search
  falls through to later rules. Tuple syntax is not accepted for solver spots.

A static fallback can keep every bot moving to a default formation between mechanics. Because the
first matching rule wins, place it after all more-specific rules:

```yaml
solvers:
  generic:
    - when: { mechanic: tower-wave }
      spot: { x: 0, z: 0 }
    - when: { static: true }
      spots:
        mt: { x: 0, z: 8 }
        ot: { x: 4, z: 8 }
```

Any positioned event can carry `labels` (a string list, matched by `when.mechanic`) and a `group`
string (compared by `when.soaks`) — currently on `aoe`, `tower`, `targeted`, and `bait` events.

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
      spot: { x: -7, z: 7 }
    # General rule: every bot stacks on the rolled group's point.
    - when: { mechanic: stack-1.g0 }
      spot: { x: -4, z: 4 }
    - when: { mechanic: stack-1.g1 }
      spot: { x: 4, z: -4 }
```

## Solver holds

`solvers.holds` makes bots **pause in place** for a fixed time after a mechanic resolves, before the
generic solver moves them on to the next spot. Each entry is `{ mechanic, duration }`:

- `mechanic` — id-prefix or label match, exactly like `when.mechanic` (pass an array to match any of
  several). When **any** mechanic matching this resolves on a given tick, the hold fires.
- `duration` — seconds every bot freezes (stops moving) after that resolve.

```yaml
solvers:
  generic: [ ... ]
  holds:
    # Hold 1s after each tower resolves before re-solving for the next mechanic.
    - { mechanic: tower-odd, duration: 1 }
    - { mechanic: tower-even, duration: 1 }
```

The hold is global (all bots) and triggers off the resolve tick, so it works for any mechanic that
flows through the tower or AOE active lists (`aoe`, `tower`, `targeted`, `bait`). Overlapping holds
extend to the latest end time. Mind tightly choreographed phases: a hold that overlaps an incoming
AOE/bait window can freeze bots out of position — keep a covering generic rule (e.g. an extended
`endAt`) over any window where bots must stay placed.

## Rotated frames

A `frame` lets one spot set serve every wave of a mechanic that rotates around the arena, so you
don't author the same formation eight times at eight angles. A spot like `{ r: 5.1265, z: 5.1265 }` is **not**
a world position — it's a coordinate in a local frame whose:

- **origin** is the arena centre `(0, 0)`,
- **+z axis ("north")** is the direction the solver computes (the bisector for `frame: matched`, or
  the normalized sum of the listed references' positions — event ids, crystals, and/or bosses),
- **+x axis ("right")** is north rotated 90° clockwise: `right = { x: north.z, z: -north.x }`.

The world position is `spot.r · right + spot.z · north`. Intuitively, **`z` pushes the bot along the
frame's north (toward the matched mechanics), `r` slides it sideways** (positive `r` = clockwise / to
the right when facing north). Both are in yalms from centre.

Alternatively, a framed spot can use polar coordinates: `{ dist, angleDeg }`. `dist` is the distance
from the arena centre and `angleDeg` is measured clockwise from frame north in degrees. At load time
this becomes `{ r: dist · sin(angleDeg), z: dist · cos(angleDeg) }`; `0` degrees is frame north and
`90` degrees is frame right. Polar spots require a `frame` and are rejected on unframed rules.

### Worked example

In Forsaken each `tower-odd` wave is the previous one rotated 45°. The healer rule is
`{ when: { mechanic: tower-odd, soaks: true, debuff: Stack Charge, role: healer }, frame: matched, spot: { r: 5.1265, z: 5.1265 } }`.
The equivalent polar spot is `{ dist: 7.25, angleDeg: 45 }`.
On wave 1 the two matched towers are at `[0, 8]` (W) and `[8, 0]` (N):

- north = normalize(`[0,8]` + `[8,0]`) = normalize(`[8,8]`) = `(0.707, 0.707)` (northeast).
- right = `(north.z, -north.x)` = `(0.707, -0.707)` (southeast).
- world = `5.1265 · right + 5.1265 · north` = `(7.25, 0)` — right on the N tower.

On wave 3 the towers have rotated 45°, north rotates with them, and the same `{ r: 5.1265, z: 5.1265 }` lands
on that wave's right tower. Two convenient identities fall out of the 45° geometry: a spot of `{ r: a, z: a }`
lands at world `(a·√2, 0)` and `[-a, a]` lands at `(0, a·√2)` — the `±` pairs you see across the
stack / cone / defamation rules.

### Adjusting a frame spot

Because the frame rotates per wave, "north/south" mean **relative to that wave's matched mechanics**,
not literal world compass directions:

- **North/south** is the second coordinate (`z`): raise `z` to move toward the matched mechanics
  (frame north), lower it to move away (frame south).
- **East/west** is the lateral coordinate (`r`): raise `r` to slide clockwise/right, lower it for
  counter-clockwise/left.

For example, to nudge `spot: { r: 8.6265, z: 5.1265 }` two yalms along the frame, leave `r` alone and
change `z`: `{ r: 8.6265, z: 7.1265 }` moves it north (toward the towers), while
`{ r: 8.6265, z: 3.1265 }` moves it south (away).
If you instead need literal world-south on every wave regardless of rotation, drop the `frame` and
author a plain world `spot`.
