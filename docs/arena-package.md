# The arena package

`src/arena/` owns the arena definition shared by authoring, simulation, and rendering: zone and
floor-plan types, schema validation, generated layouts, floor membership, packaged images, and
Babylon mesh creation. Consumers import it through `@arena`, `@arena/schema`, or `@arena/babylon`.

## Layout and entry points

```
src/arena/
  index.ts       # canonical types, floor membership, and public core exports
  schema.ts      # authored arena and zone validation
  generators.ts  # named generated layouts
  assets.ts      # image-id registry and preload manifest
  images/        # floor-plan and textured-zone art, served at /arena-images/
  babylon/       # floor geometry, materials, textures, and loading placeholders
```

`@arena` is safe in the deterministic engine and exposes plain serializable data. `@arena/schema`
normalizes authored `{ x, z }` objects and `[x, z]` tuples into the canonical object form, then
resolves a named generator before the raid reaches `createWorld`. Only the browser renderer may
import `@arena/babylon`; the engine never imports Babylon.

`src/shared/world/foundation.ts` re-exports the arena types so existing world-model consumers can
continue importing `@shared/types` without creating a second definition.

## Images and mesh creation

Every image identifier and relative filename is declared once in `assets.ts`. The same registry
drives schema enums, renderer lookup, browser preloading, and tests that verify each file exists.
Adding an image therefore requires adding the file and its registry entry; do not add a parallel
mapping in the client.

`createArenaMeshes(scene, arena, imageRoot)` returns the root meshes owned by the caller. Disposing
each root with `mesh.dispose(false, true)` also disposes its child geometry, materials, and textures.
Image-backed floors display the existing crosshatch placeholder until Babylon finishes loading the
texture. Polygon UV projection, Index slab sides, and the brighter circular floor-plan material are
kept inside the package rather than encoded by the renderer.

## Generated layouts and floor membership

`ARENA_GENERATORS` contains layouts that cannot be represented conveniently as a simple authored
zone list. A generator returns the same `ZoneShape[]` as inline authoring, so simulation and
rendering do not branch on its identity. `isOnFloor` tests the union of all zones and is shared by
authoritative movement and client prediction.

The package boundary tests enforce that core arena code does not import the engine, client, server,
effects, or status packages; consumers use only the public entry points; and the engine never
imports `@arena/babylon`.
