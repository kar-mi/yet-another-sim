# The effects package

`src/effects/` holds the reusable visual vocabulary the renderer draws with: AoE footprint
geometry, ground circles, glow rings, connecting lines, element patterns and bursts, procedural
markers, and mesh-targeted glow. It is imported through the `@effects` and `@effects/babylon`
aliases (see `tsconfig.json`).

The split from `src/client/render/` is by *what the code knows about*, not by what it draws.
Anything that needs to know about a mechanic, a player, the World, raid ids or the asset root stays
in the renderer. The package receives visual properties, positions, times and explicit meshes.

## Layout

```
src/effects/
  index.ts       # shape and element types, FloorAoe, visibility, vfx option types
  sampling.ts    # uniform random points inside a footprint
  schema.ts      # zod validation for the authored vfx block
  babylon/       # everything that touches Babylon: geometry, materials, handles, prewarming
```

`index.ts` owns the canonical `AOEShape`, `ElementGlyphKind` and `WaymarkId`. `src/shared/world/
foundation.ts` re-exports them, so simulator code keeps importing `@shared/types` as before.

## The import boundary

`@effects` may import Babylon and `@shared/math` — pure `{ x, z }` vector helpers, no simulator
concepts. Nothing else from `@shared`, and nothing from `src/client`, `src/engine` or `src/server`.
In the other direction the engine must never import Babylon or `@effects/babylon`, because it runs
headless on the server.

Both rules are enforced by `src/effects/__tests__/boundaries.test.ts`, which scans import
specifiers rather than relying on convention.

## Who draws with what

Each primitive exists because several renderer layers wanted the same visual, so a change to one
lands everywhere it should.

| Primitive | Drawn by |
|-----------|----------|
| `createShapeMesh` / `createShapeOutlineMesh` | the telegraph layer and every other footprint (the inverse "?" telegraph, gazes, stacks) |
| `syncFloorAoeMeshes` | every layer that renders a `FloorAoe` |
| `createGroundCircle` | spread/stack areas, forced-march zones, tower soak counters |
| `createGlowRing` | boss target rings, player status rings, the "?" mechanic ring |
| `createLine` / `updateLine` | tethers and line links |
| `createMeshGlow` | the Index weapon highlight |

Art that only one mechanic uses — the boss-side orbs, the forced-march arrow, the tower pillar and
falling object — deliberately stays a separate factory in `src/client/render/meshes/`. Those
factories call into the package for their shared parts and keep their own distinctive geometry.

## Resource ownership

A factory returns a small handle owning its own geometry and private material, and the caller
disposes it. The exception is anything cached per scene: the element floor materials (shared per
element/colour/alpha) and the burst dot texture belong to the scene, and a caller must never
dispose them. `syncFloorAoeMeshes` encodes this — it frees an outline's own material but leaves a
shared element material alone, because other AoEs on screen are still drawing with it.

## FloorAoe is plain data

`FloorAoe` has no instance methods on purpose. The World is `JSON.stringify`'d for lockstep hashing
(`src/shared/worldHash.ts`) and `JSON.parse`'d back out of replay files
(`src/server/replayReader.ts`), so a `FloorAoe` embedded in World state has to keep working after a
round trip that loses its prototype. Visibility therefore lives in the standalone
`isFloorAoeVisible` function, and authored `vfx` overrides ride the FloorAoe so they survive both
the round trip and a deferred cleave being re-anchored when a bait arms it.

The `DEFAULT_*` colour constants exist because `color` is required on `FloorAoe` — there is no
implicit convention inside the class or the renderer. Engine construction sites pass one of them
when a mechanic authors no colour of its own.

## Shader prewarming

The first time a material family appears mid-fight, Babylon compiles its shader synchronously on
the main thread, which shows up as a hitch. `prewarmShaders` renders one throwaway representative
of each family at load. Babylon caches compiled effects by their defines until the engine is
disposed, so warming one instance covers every later one; the temporary mesh and material are
disposed afterwards and the cached effect persists.

Add a family by appending one factory to the `warmups` array in `src/effects/babylon/prewarm.ts`.
Weapon art loads asynchronously, so the weapon glow warms separately, from
`MeshGlow.warm` whenever nothing is highlighted.

## Authoring controls

The `vfx` block on an `aoe` event overrides the floor pattern, the impact burst and the weapon
glow. `schema.ts` validates it centrally. The field-by-field reference lives with the rest of the
raid format in [Authoring Raids](authoring-raids.md#visual-effects-vfx); `raids/debug/vfx-test.yaml`
exercises every shape and every override.
