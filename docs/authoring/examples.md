# Worked examples

Start from a complete small encounter, then read how the shipped files use the more involved parts
of the format. Every example here points at a file in the repository rather than restating it —
those files are executable and validated on every build, so they cannot drift out of date the way a
pasted copy would.

## A complete encounter

[`raids/debug/authoring-demo.yaml`](../../raids/debug/authoring-demo.yaml) is a 45-second encounter
on a radius-30 circle with three mechanics. It is the smallest file that exercises the shape of the
format, and it is the example the [raid reference](../authoring-raids.md#worked-example) walks
through field by field.

Its skeleton:

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
  # ...seven more
```

Then three events, one of each of the shapes you will reach for most often.

**A raidwide.** No `type` means `aoe`, the default. The shape covers the whole floor, so there is
nowhere to stand — this is damage the party is meant to take.

```yaml
- id: raidwide
  time: 3
  name: Raidwide
  telegraph: 3
  damage: 30
  damageType: magical
  showCastBar: true
  shape: { kind: circle, center: { x: 0, z: 0 }, radius: 30 }
```

**A baited tankbuster.** `type: targeted` centres its circle on a player chosen at cast time rather
than on a fixed point. `targetMode: closest` plus `role: tank` picks the nearest tank.

```yaml
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
```

**A donut.** The `donut` shape is a get-in: safe inside `inner`, lethal from `inner` to `outer`.

```yaml
- id: shockwave
  time: 18
  name: Shockwave
  telegraph: 4
  damage: 100
  damageType: magical
  shape: { kind: donut, center: { x: 0, z: 0 }, inner: 7, outer: 28 }
```

Three events, three ideas: fixed geometry, geometry that follows a player, and geometry with a hole
in it. Most mechanics are a variation on one of those.

## One mechanic at a time

The `raids/debug/` category is a library of minimal encounters, roughly one per event type. When you
want to see how a mechanic behaves before building around it, load the matching debug raid rather
than reading the schema:

| To see | Load |
|---|---|
| Tower soaks | [`tower-test.yaml`](../../raids/debug/tower-test.yaml) |
| Knockback and anti-knockback | [`knockback-test.yaml`](../../raids/debug/knockback-test.yaml) |
| Look-away gazes | [`gaze-test.yaml`](../../raids/debug/gaze-test.yaml) |
| Spread ↔ stack flips | [`spread-stack-test.yaml`](../../raids/debug/spread-stack-test.yaml) |
| Debuff application and expiry | [`debuff-test.yaml`](../../raids/debug/debuff-test.yaml) |
| Limit cut ordering | [`limit-cut.yaml`](../../raids/debug/limit-cut.yaml) |
| Divebomb sweeps | [`divebomb-test.yaml`](../../raids/debug/divebomb-test.yaml) |
| Non-circular arenas | [`arena-zones-test.yaml`](../../raids/debug/arena-zones-test.yaml) |

## Reusing values with YAML anchors

Real encounters repeat the same mechanic with different times and positions. Rather than copying a
block eight times, define it once as an anchor and merge it in.

[`forsaken.yaml`](../../raids/dancing-mad-ultimate/forsaken.yaml) declares one tower shape and uses
it for all eight waves:

```yaml
_towerBase: &towerBase
  type: tower
  telegraph: 10
  radius: 4
  requiredCount: 2
  failureDamage: 999999
  failureDamageType: "true"
  avoidable: true
  consumeEffect: { effectName: "Spells' Trouble" }
  resolveEventIds: [forsaken-stack-resolve, forsaken-cone-resolve, forsaken-defamation-resolve]

- <<: *towerBase
  id: tower-1-left
  time: 8.0
  name: Forsaken Tower 1 Left (A)
  labels: [tower-odd]
  group: A
  pos: *posW
```

Two conventions worth copying from that file:

- Keys that only exist to hold anchors are prefixed with `_`, so it is obvious they are not part of
  the schema.
- Positions get their own anchor block (`_towerPos`), so a position is named once and referenced
  everywhere it is used.

`avoidable: true` on the base is doing review work, not gameplay work: it marks the tower's failure
damage as something the party could have prevented, so it shows up under `AVOIDABLE HITS` in replay
review instead of being filed with unavoidable raidwides.

## Deferred casts and baits

Some mechanics are stored when they are cast and fired later, aimed at wherever a player is at the
moment of release. That is two events linked by id.

The stored half is an ordinary `aoe` with `deferred: true`, anchored to the boss and oriented by its
facing:

```yaml
_endingBase: &endingBase
  type: aoe
  deferred: true
  anchor: boss
  directionFrom: bossFacing
  telegraph: 5
  damage: 90
  damageType: magical
  avoidable: true
  shape: { kind: cone, angleDeg: 180, length: 24 }
  telegraphMode: resolve
  showCastBar: false
```

The firing half is a `bait`, which turns the boss and releases the stored event it names:

```yaml
- type: bait
  id: all-ending-1
  time: 33.0
  name: All Ending
  targetMode: closest
  telegraph: 5
  showCastBar: true
  link: ending-store-1
```

The `link` is the whole relationship: the stored cone has no timer of its own, and the bait has no
shape of its own. See [`bait`](../authoring-raids.md#bait--turn-lock-and-aim-a-stored-cleave) for
the full field list.

## Effects that resolve when something else happens

A debuff does not have to resolve on a timer. In `forsaken.yaml` three `effect_resolver` events sit
in the timeline with no `time` at all — they are fired by the towers that name them in
`resolveEventIds`, and each one consumes a named effect from whoever soaked:

```yaml
- type: effect_resolver
  id: forsaken-stack-resolve
  name: Stack Resolve
  effectName: Stack Charge
  action: { kind: stack, radius: 4.5, requiredCount: 3, damage: 80, damageType: magical }
```

That is the general pattern for "the debuff you are holding decides what the mechanic does to you":
the mechanic event carries the trigger, the resolver carries the outcome, and the effect name joins
them.

## Seeded variation

Everything random in an encounter is declared under `optionals`, derived from the pull seed, and
exposed to the host as a pinnable choice.

**Naming the choices.** `rngLabels` gives each seeded decision a label and human-readable options.
These strings are exactly what appears in **RAID SETUP → RNG**, so writing them well is what makes an
encounter practisable:

```yaml
optionals:
  rngLabels:
    plant-swap:
      label: Arrow groups
      options: [Support same arrow, DPS same arrow]
```

**Swapping whole sets of events.** `eventSets` picks one list of event ids to activate and drops the
others. `black-hole.yaml` uses it to mirror a mechanic left/right by authoring both sides and
letting the roll choose:

```yaml
eventSets:
  slap-happy-1:
    rng: true
    sets:
      - [slap-happy-1-right-hit-1, slap-happy-1-right-hit-2, slap-happy-1-right-hit-3]
      - [slap-happy-1-left-hit-1, slap-happy-1-left-hit-2, slap-happy-1-left-hit-3]
```

**Assigning per-player values.** `combinations` distributes plans across the roster —
`plant` for directional assignments, `pairings` for duos with group letters and starting charges,
`endings` for shuffling cast variants across slots. See
[Optional combinations](../authoring-raids.md#optional-combinations) for each one's fields.

The reason to push variation through `optionals` rather than inventing your own randomness is that
`optionals` is seeded, reproducible, pinnable by the host, and visible to the bot solver. Ad-hoc
randomness would be none of those things — and would desync.

## Bot patterns

A bot file has two halves, and most encounters use both.

**Waypoints** are static: a player id, a time, a position. They are enough for openers and for any
formation that does not depend on what the pull rolled.

```yaml
players:
  mt:
    - { time: 0, pos: { x: 0, z: 6 } }
  ot:
    - { time: 0, pos: { x: 5, z: 0 } }
```

**Solver rules** are reactive: an ordered list of conditions, each with a destination. The first
rule whose condition matches a bot wins, so the list is a priority order.

[`graven-image-3-bots.yaml`](../../raids/dancing-mad-ultimate/graven-image-3-bots.yaml) shows the
common shapes in one file:

```yaml
solvers:
  generic:
    # React to the player's own assigned combination.
    - { when: { plant: right right, plantSlot: 0 }, spot: { x: 0, z: 12 } }

    # React to a live mechanic, placing the whole party at once.
    - when: { mechanic: fire-1.spread }
      spots: { mt: { x: 6, z: 6 }, ot: { x: 6, z: -6 }, h1: { x: 0, z: -18 } }

    # React to a debuff, from a given time onwards.
    - when: { debuff: Double Trouble, role: tank }
      startAt: 20
      spot: { x: -8, z: 7 }

    # Timeline fallback: no condition, just "be here after this time".
    - when: { static: true }
      startAt: 14
      spots: { mt: { x: -5, z: 5 } }
```

Three things generalise from that:

**Order resolves conflicts.** When two mechanics overlap, the fix is usually to put the more urgent
rule earlier in the list, not to add another condition to both. Conditions describe *what is true*;
position in the list describes *what wins*.

**`spot` versus `spots`.** `spot` gives one destination to whichever bot matched. `spots` gives a
whole table keyed by player id, which is what you want when a mechanic positions the entire party.

**Fallbacks go last, newest first.** A `static: true` rule with a `startAt` stays active until
something later overrides it, so a bot omitted from a partial formation keeps its most recent
complete one.

### Rotated frames

When a mechanic appears at a different rotation each pull, authoring eight copies of the same spots
is the wrong answer. Instead author them once in a **frame** whose north is defined by the mechanic
itself, and let the engine rotate them:

```yaml
- { when: { mechanic: tower-odd, soaks: true, debuff: Stack Charge },
    frame: matched, spot: { r: 7, z: 2 } }
```

`forsaken-bots.yaml` uses this for all eight tower waves — one set of relative positions, rotated
45° per wave. The full mechanics are in
[Rotated frames](../authoring-bot-patterns.md#rotated-frames).

### What bots are for

Bot patterns in this repository are written for **survival and correct resolution**, not optimal
play. A bot that reaches a safe spot by an inelegant route is doing its job; a bot that dies and
leaves a tower unsoaked is not, because it costs the human players the rest of the timeline.

When testing your own patterns, turn on **RAID SETUP → BOTS → All bots invincible** so one early bot death does not hide whether the
rest of your rules work.

## Where to go next

- Field-by-field reference: [Authoring raids](../authoring-raids.md)
- Bot reference: [Authoring bot patterns](../authoring-bot-patterns.md)
- Adding a debuff that does not exist yet: [Looking up debuff icons](./debuff-lookup.md)
- Adding a new *event type* rather than a new encounter:
  [Deterministic lockstep](../deterministic-lockstep.md)
