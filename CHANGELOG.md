# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
