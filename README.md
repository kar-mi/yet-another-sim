# Yet Another Sim

A base raid simulator for FFXIV-style encounters.

The project runs a server-authoritative TypeScript simulation with a browser client for
rendering and input. Raid encounters are authored as YAML timelines under `raids/`, then
loaded by the Bun server and played in the browser. The browser can connect through the
Colyseus multiplayer server or run a static single-player build with generated raid data.

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
bun run dev                   # Run the Bun server
bun run start                 # Run the Bun server
bun run build                 # Build the browser bundle into .bundle/
bun run build:static          # Build the static single-player bundle into .bundle-static/
bun run generate:static-raids # Generate embedded raid data for static builds
bun run typecheck             # Run TypeScript checks
bun test                      # Run tests
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
- Colyseus multiplayer transport and static single-player loopback mode
- Browser rendering with Babylon.js
- YAML-authored arenas, waymarks, bot movement, and timelines
- AOE, targeted bait, tether, chain, group stack, tower, knockback, limit cut, divebomb, and effect mechanics

## Credits

- `3d-crabz`: https://sovietshnuckums.itch.io/3d-crabz

Status images from https://v2.xivapi.com/

Floor arena images - https://github.com/kotarou3/ffxiv-arena-images

## AI Usage

This repository includes code, documentation, or asset integration work assisted by AI tools such as Claude and Codex. Changes produced with AI assistance should still be reviewed, tested, and understood before merge.

## Changelog

Notable release notes are tracked in [CHANGELOG.md](CHANGELOG.md).
