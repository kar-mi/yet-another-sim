# Yet Another Sim

Yet Another Sim is a browser sandbox for practising FFXIV-style raid mechanics. It runs a
deterministic simulation in every player's browser, relayed through a server so that up to eight
people see exactly the same fight. Empty party slots are filled by bots, so you can drill a
mechanic alone or with a full group.

Encounters are authored as YAML timelines, which means the simulator is also a tool for *writing*
fights, not just playing them.

## Where to go

| If you want to | Start at |
|---|---|
| Get into a session and dodge something | [Getting started](./getting-started.md) |
| Understand the controls, HUD and replays | [Simulator guide](./simulator-guide.md) |
| Build your own encounter | [Authoring overview](./authoring/index.md) |
| Fix lag, missing visuals or connection problems | [Browser & performance help](./troubleshooting/browsers.md) |
| Work on the simulator itself | [Development workflow](./workflow.md) |

## What is in the simulator today

The published encounter set is **Dancing Mad Ultimate**, with five phases: *Graven Image 3*,
*Forsaken*, *Black Hole*, *Bowels of Agony* and *Kefka Says*. They are listed in the raid browser
under that category.

Alongside those there is a **Debug** category holding one small raid per mechanic type — towers,
knockbacks, gazes, limit cut, and so on. Those are the fastest way to see a single mechanic in
isolation, and they are what the authoring documentation uses for its examples.

## What it does not simulate

The simulator models *positioning and mechanic resolution*, not the rest of the game. There are no
jobs, no rotations, no damage you deal, no aggro beyond a fixed tank assignment, and no healing you
cast — recovery between mechanics is scripted into the timeline. Damage numbers exist only so that
a mistake can kill you.
