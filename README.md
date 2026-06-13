# Yet Another Sim

A base raid simulator for FFXIV-style encounters.

The project runs a server-authoritative TypeScript simulation with a browser client for
rendering and input. Raid encounters are authored as YAML timelines under `raids/`, then
loaded by the Bun server and played in the browser.

## Requirements

- [Bun](https://bun.sh/)

## Getting Started

Install dependencies:

```sh
bun install
```

Start the development server:

```sh
bun run dev
```

Open the app at:

```text
http://localhost:3000
```

## Scripts

```sh
bun run dev        # Run the Bun server in watch mode
bun run start      # Run the Bun server
bun run build      # Build the browser bundle into .bundle/
bun run typecheck  # Run TypeScript checks
bun test           # Run tests
```

## Raid Authoring

Raid files live in `raids/<category>/<raid-id>.yaml` (`.yml` also works). Each
raid defines an arena, an 8-player roster, and a timeline of mechanics. Category folders
include a `raid_info.yaml` file used by the raid browser.

Useful docs:

- [Authoring Raids](docs/authoring-raids.md)
- [Authoring Bot Patterns](docs/authoring-bot-patterns.md)
- [Movement & Scale](docs/movement-and-scale.md)

## Current Scope

The simulator currently supports the base loop for FFXIV-style raid mechanics:

- 8-player tank/healer/DPS rosters
- Server-authoritative movement and simulation ticks
- Browser rendering with Babylon.js
- YAML-authored arenas, waymarks, bot movement, and timelines
- AOE, targeted bait, tether, chain, group stack, tower, knockback, and effect mechanics

## Credits

- `3d-crabz`: https://sovietshnuckums.itch.io/3d-crabz
- "Skeith - dotHack//IMOQ Minecraft" (https://skfb.ly/6XxtB) by AzureDoomC is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/). 

Status images from https://v2.xivapi.com/

## AI Usage

This repository includes code, documentation, or asset integration work assisted by AI tools such as Claude and Codex. Changes produced with AI assistance should still be reviewed, tested, and understood before merge.

## Changelog

Notable release notes are tracked in [CHANGELOG.md](CHANGELOG.md).
