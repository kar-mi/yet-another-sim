# Yet Another Sim

Yet Another Sim is a browser sandbox for practising FFXIV-style raid mechanics. It runs a
deterministic simulation in every player's browser, relayed through a server so that up to eight
people see exactly the same fight. Empty party slots are filled by bots, so you can drill a
mechanic alone or with a full group.

Encounters are authored as YAML timelines, which means the simulator is also a tool for *writing*
fights, not just playing them.

## What is in the simulator today

Encounters are grouped into categories in the raid browser, and the list comes from whatever raid
files the server is serving — so what you see there depends on the deployment rather than being
fixed by the client.

What every encounter is built from is the same:

- **An eight-player roster** of two tanks, two healers and four DPS, in fixed slots that mechanics
  target by name.
- **An arena** assembled from circles, rectangles and polygons, with waymarks. Anything outside the
  floor is a fall, and a fall is fatal.
- **A timeline** of mechanics resolving on a clock: area attacks of every shape, baited and targeted
  hits, tethers and chains, stacks and spreads, towers to soak, knockbacks, gazes, dashes and
  divebombs, limit cut ordering, and buffs and debuffs that change what a later mechanic does to
  you.
- **Seeded per-pull variation**, so a fight is not the same every time — and any of it can be pinned
  by the host to drill one case repeatedly.
- **Bots** filling every unclaimed slot, following movement authored alongside the encounter.
- **A recording** of each stopped pull, reviewable afterwards with every death and avoidable hit
  listed.

Alongside those there is a **Debug** category holding one small raid per mechanic type — towers,
knockbacks, gazes, limit cut, and so on. Those are the fastest way to see a single mechanic in
isolation, and they are what the authoring documentation uses for its examples.

## What it does not simulate

The simulator models *positioning and mechanic resolution*, not the rest of the game. There are no
jobs, no rotations, no damage you deal, no aggro beyond a fixed tank assignment, and no healing you
cast — recovery between mechanics is scripted into the timeline. Damage numbers exist only so that
a mistake can kill you.
