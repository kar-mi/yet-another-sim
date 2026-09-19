# Authoring overview

An encounter in Yet Another Sim is a YAML file. There is no scripting language, no code to compile,
and no plugin to register: you describe an arena, a roster and a list of timed events, drop the file
under `raids/`, and the server picks it up.

This page is the map. The detailed references are:

| Document | Covers |
|---|---|
| [Authoring raids](../authoring-raids.md) | Every field of the raid format: arenas, waymarks, rosters, all event types, effects, optionals |
| [Authoring bot patterns](../authoring-bot-patterns.md) | Moving the bot-controlled party members: waypoints, the generic solver, rotated frames |
| [Movement & scale](../movement-and-scale.md) | How distances and speeds map onto FFXIV yalms |
| [Worked examples](./examples.md) | A complete small encounter end to end, then annotated pieces of the shipped files |
| [Looking up debuff icons](./debuff-lookup.md) | Finding a status name and its icon when registering a new debuff |

## How a raid is put together

A raid is two files that live next to each other:

```text
raids/
  <category>/
    raid_info.yaml       category name + description, shown in the raid browser
    <raid-id>.yaml       the encounter: arena, roster, timeline
    <raid-id>-bots.yaml  how bot-controlled party members move (optional)
```

The raid id the client uses is `<category>/<raid-id>`, which is also the path without the extension.
Both `.yaml` and `.yml` work.

The encounter file attaches its bot file by id:

```yaml
botPatterns: my-encounter-bots
```

A raid without that key simply has bots that stand where they spawned — which is fine while you are
building a timeline, and is what the debug raids do.

## The four things a raid file declares

**An arena.** A list of zones — circles, rectangles, polygons — where a point is "on the floor" if
it is inside any of them. Anything outside every zone is a fall, and a fall is fatal. Combine zones
to build non-circular arenas.

**A roster.** Always the same eight slots (`mt`, `ot`, `h1`, `h2`, `m1`, `m2`, `r1`, `r2`) with a
role and a spawn point each. The slot ids are how the timeline targets specific players, so they are
not interchangeable labels.

**A timeline.** A list of events, each with a `time` in seconds from the pull, a `telegraph`
duration, and a type that decides its shape and behaviour. Events are declared in any order; `time`
is what sequences them.

**Optionals.** Seeded per-pull variation — which side a mechanic comes from, which of two debuffs
you get, how a set of assignments is distributed. Everything here is derived from the pull seed, so
a given seed always produces the same fight, and each choice can be pinned by the host from the
in-game **OPTIONS → RNG** panel.

## Coordinates

- The arena is a 2D plane of `{ x, z }` positions. `+z` is north (12 o'clock), `+x` is east
  (3 o'clock), and directions run clockwise.
- `y` is vertical (jumping) and is never authored.
- One unit is one FFXIV yalm. Author distances, radii and waymarks directly in yalms.
- A standard single-circle arena is radius 20.

The fastest way to find a coordinate is to stand on it: the HUD's position helper (**⌖** in the
hotbar panel) prints your current position, and clicking the readout copies it.

## The authoring loop

```sh
bun run dev          # server + client, http://localhost:3000
```

1. Write or edit the YAML under `raids/`.
2. Reload the raid in the client — the server re-reads the file, so there is no restart for
   content-only changes.
3. Watch it resolve. Use **STOP** to save the pull, then the replay's **EVENTS** sidebar to see
   exactly who was hit by what and when.
4. Adjust times and positions; repeat.

Two habits pay for themselves immediately:

- **Add `sections`** as soon as your timeline is more than a few events long. They are purely
  descriptive bookmarks, but they turn the replay's *jump to mechanic* dropdown into a usable index
  of your fight.
- **Tag avoidable damage** with `avoidable: true` on anything the party is supposed to dodge. That
  is what makes the replay's `AVOIDABLE HITS` filter meaningful — untagged damage is treated as
  something everyone is meant to eat, and is left out of review.

## Validation

The schema runs whenever the server loads a raid. A malformed file throws a descriptive error rather
than loading a broken encounter, so the feedback loop is a reload, not a debugging session.

Two rules catch most first-time mistakes:

- **Statuses must be registered.** Every buff and debuff has to exist in the status catalog
  (`src/status/catalog/buffs.ts` or `src/status/catalog/debuffs.ts`) and be referenced by `ref:`.
  Inline status definitions are rejected.
- **Ids must be unique** within a file, because events reference each other by id — a `bait` finds
  its stored cone that way, and a tower finds its resolvers that way.

To check a file without opening the client, start the server and load the raid; the loader is the
validator.

## Determinism

Every client runs the same simulation and must reach the same result. That constrains what an
encounter may do, but as an author you get it for free as long as you stay inside the format: all
randomness comes from the seeded optionals, and there is no way to express a non-deterministic
event in YAML.

It matters if you go further and add a new *event type* in TypeScript. The rules for that are in
[Deterministic lockstep](../deterministic-lockstep.md), and they are not optional — a desync shows
up as players disagreeing about who died.
