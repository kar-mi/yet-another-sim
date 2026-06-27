# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-06-27

### Added

- Colyseus-backed multiplayer transport with reconnect support.
- Static build path with generated raid data and loopback single-player transport.
- RNG variants for Bowls of Agony debuffs and swap order.

### Changed

- Split relay room logic so multiplayer and static single-player modes share the core message flow.
- Improved animation rendering, asset loading, and boss ring placement.

### Fixed

- Fixed static build and single-player interaction regressions.
- Fixed Bowls bot positions and debuff RNG behavior.

## [0.4.0] - 2026-06-24

### Added

- New raid content: Bowls of Agony, plus Exdeath and Chaos bosses with their models.
- Multi-boss support via a boss registry, enabling encounters with more than one boss.
- New mechanics: limit cut, earthquake, white hole, dive bombs, boss dash, head wind/tailwind, entropy dynamic fluid, swap target, and generic assignment.
- Raid encounter timer.
- Generic double-trouble debuff and a swappable raid selector.
- Authoring support for angles in degrees, solving on position, and static-value bot intents.
- HUD rewrite and general UI updates, including a session-expired message and removal of the targeting ring from non-targeted players.
- Expanded debug tooling and debug button.

### Changed

- Client and general performance optimizations.
- Improved bot positioning, particularly for the Bowls encounter.
- Split the deployment workflow and adjusted version handling in CI.
- Moved asset loading to startup.

### Fixed

- Fixed knockback and limit cut behavior.
- CORS and security hardening.
- Fixed a Windows compatibility issue.

## [0.3.0] - 2026-06-16

### Added

- Observability stack: OpenTelemetry tracing and metrics, plus spectator/observer functionality.
- Controller support improvements: configurable keybind rebinding, legacy vs. standard control schemes, and player animations.
- Generic raid authoring via YAML, boss-specific raid definitions, and a reusable mechanics resolver (replacing Forsaken-specific code).
- New mechanics and content: debuff tower, far/near stored bait, link IDs, and an "active" status icon.
- Bot solver with a configurable gap option.
- Session and message limits to protect server resources.
- Animated floor patterns with asset preloading, static images, and additional color options.

### Changed

- Swapped Sentry for OpenTelemetry as the observability backend.
- Shifted rendering focus to the client engine.
- Refactored the server: split `session.ts`, reorganized server files, and consolidated the simulation.
- Removed the cast bar timer, flipped the debuff image, and removed movement inertia.
- World logging and asset loading optimizations.

### Fixed

- Input delay improvements and removal of state resync.
- Client, engine, and model cleanup, plus additional environment protection.
- Dead code cleanup.

## [0.2.0] - 2026-06-08

### Added

- Direct link/tether mechanics, rendering, raid schema support, and authoring docs.
- Inverse, gaze, forced march, spread/stack, lightning variant, and generic debuff mechanics with tests and debug raids.
- Graven Image 3 raid content, including bot coverage and related raid metadata.
- Deployment assets for Docker Compose and `deploy.sh`.

### Changed

- Refactored client UI code into focused modules for the main menu, raid HUD selection, settings panel, DOM helpers, and render meshes.
- Cleaned up action bar drift behavior and HUD presentation.
- Expanded raid authoring documentation for the new mechanics and encounter patterns.

### Fixed

- Fixed HUD transparency styling.
- Fixed debuff RNG behavior.
- Fixed final Graven Image mechanic behavior.

## [0.1.0] - 2026-06-06

### Added

- Base raid simulator for FFXIV.
