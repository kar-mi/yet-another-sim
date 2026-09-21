import { afterAll, beforeAll, expect, test } from "bun:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { createArenaMeshes } from "@arena/babylon";

let originalDocument: PropertyDescriptor | undefined;

beforeAll(() => {
  originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const context = new Proxy({}, { get: () => () => ({ width: 1, addColorStop: () => {} }), set: () => true });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    baseURI: "http://localhost/",
    removeEventListener: () => {},
    createElement: () => ({ width: 1, height: 1, getContext: () => context }),
  } });
});

afterAll(() => {
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

function withScene(run: (scene: Scene) => void): void {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    run(scene);
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

test("creates every supported untextured arena zone", () => {
  withScene(scene => {
    const before = { meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length };
    const roots = createArenaMeshes(scene, {
      floorPlan: { color: "#123456" },
      zones: [
        { kind: "circle", center: { x: 0, z: 0 }, radius: 4 },
        { kind: "rect", center: { x: 10, z: 0 }, width: 4, height: 8 },
        { kind: "polygon", vertices: [{ x: -4, z: -4 }, { x: 0, z: -4 }, { x: 0, z: 0 }, { x: -4, z: 0 }] },
      ],
    }, "/arena-images");
    expect(roots).toHaveLength(3);
    expect(roots.every(mesh => mesh.material !== null)).toBe(true);
    for (const mesh of roots) mesh.dispose(false, true);
    expect({ meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length }).toEqual(before);
  });
});

test("unsupported non-quad polygons are omitted", () => {
  withScene(scene => {
    const before = { meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length };
    const roots = createArenaMeshes(scene, {
      floorPlan: { color: "#123456" },
      zones: [{ kind: "polygon", vertices: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }] }],
    }, "/arena-images");
    expect(roots).toEqual([]);
    expect({ meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length }).toEqual(before);
  });
});

test("image-backed circles and polygons own and dispose their complete resource trees", () => {
  withScene(scene => {
    const warmup = createArenaMeshes(scene, {
      floorPlan: "dmu-p1",
      zones: [{ kind: "circle", center: { x: 0, z: 0 }, radius: 1 }],
    }, "/arena-images");
    for (const mesh of warmup) mesh.dispose(false, true);
    const baseline = { meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length };

    const roots = createArenaMeshes(scene, {
      floorPlan: "dmu-p2",
      zones: [
        { kind: "circle", center: { x: 0, z: 0 }, radius: 4 },
        {
          kind: "polygon",
          image: "index-square",
          vertices: [{ x: 5, z: -2 }, { x: 9, z: -2 }, { x: 9, z: 2 }, { x: 5, z: 2 }],
        },
      ],
    }, "/arena-images");
    expect(roots).toHaveLength(2);
    expect(scene.textures.length).toBeGreaterThan(baseline.textures);
    for (const mesh of roots) mesh.dispose(false, true);
    expect({ meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length }).toEqual(baseline);
  });
});
