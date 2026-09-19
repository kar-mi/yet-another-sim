import { afterAll, beforeAll, expect, test } from "bun:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { FloorAoe } from "@effects";
import { createMeshGlow, disposeFloorAoeMeshes, syncFloorAoeMeshes, type FloorAoeMeshMap } from "@effects/babylon";

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

const aoe = (id: string, element?: "fire" | "ice") => new FloorAoe({
  id,
  shape: { kind: "circle", center: { x: 0, z: 0 }, radius: 4 },
  color: "#ff2200",
  ...(element ? { element } : {}),
  resolveMode: { kind: "active" },
  resolveAt: 10,
});

// Babylon creates its "default material" lazily on the first mesh, so counts are only comparable
// after one warm-up cycle.
function warmUp(scene: Scene): { meshes: number; materials: number } {
  const meshes: FloorAoeMeshMap = new Map();
  syncFloorAoeMeshes(scene, meshes, [aoe("warm-up")], 0, new Set());
  disposeFloorAoeMeshes(meshes);
  return { meshes: scene.meshes.length, materials: scene.materials.length };
}

function withScene<T>(run: (scene: Scene) => T): T {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    return run(scene);
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

test("repeated create/remove cycles leave no meshes or materials behind", () => {
  withScene(scene => {
    const baseline = warmUp(scene);
    const meshes: FloorAoeMeshMap = new Map();
    for (let i = 0; i < 20; i++) {
      syncFloorAoeMeshes(scene, meshes, [aoe("cycle")], 0, new Set());
      expect(meshes.size).toBe(1);
      syncFloorAoeMeshes(scene, meshes, [], 0, new Set());
      expect(meshes.size).toBe(0);
    }
    expect(scene.meshes.length).toBe(baseline.meshes);
    expect(scene.materials.length).toBe(baseline.materials);
  });
});

test("outlined AoEs dispose their fill and its material with the outline", () => {
  withScene(scene => {
    const baseline = warmUp(scene);
    const meshes: FloorAoeMeshMap = new Map();
    const outlined = new FloorAoe({
      id: "outlined",
      shape: { kind: "donut", center: { x: 0, z: 0 }, inner: 2, outer: 5 },
      color: "#00ff00", style: "outline",
      resolveMode: { kind: "active" }, resolveAt: 10,
    });
    syncFloorAoeMeshes(scene, meshes, [outlined], 0, new Set());
    expect(scene.meshes.length).toBeGreaterThan(baseline.meshes);
    disposeFloorAoeMeshes(meshes);
    expect(scene.meshes.length).toBe(baseline.meshes);
    expect(scene.materials.length).toBe(baseline.materials);
  });
});

test("simultaneous element AoEs share one pattern material, and it survives removing one", () => {
  withScene(scene => {
    const meshes: FloorAoeMeshMap = new Map();
    syncFloorAoeMeshes(scene, meshes, [aoe("a", "fire"), aoe("b", "fire"), aoe("c", "ice")], 0, new Set());
    const fireA = meshes.get("a")!.mesh.material;
    const fireB = meshes.get("b")!.mesh.material;
    const ice = meshes.get("c")!.mesh.material;
    expect(fireA).toBe(fireB!);
    expect(fireA).not.toBe(ice!);

    // Dropping one fire AoE must not dispose the material the other is still drawing with.
    syncFloorAoeMeshes(scene, meshes, [aoe("b", "fire")], 0, new Set());
    expect(meshes.get("b")!.mesh.material).toBe(fireA!);
    expect(scene.materials).toContain(fireA!);
  });
});

test("scene teardown after effects are live does not throw", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const meshes: FloorAoeMeshMap = new Map();
  syncFloorAoeMeshes(scene, meshes, [aoe("live", "fire"), aoe("plain")], 0, new Set());
  const glow = createMeshGlow(scene, "teardown-glow", new Mesh("teardown-root", scene), {
    glowColor: new Color4(1, 1, 1, 1),
    haloColor: new Color3(1, 1, 1),
    intensity: { min: 1, max: 2 },
    haloAlpha: { min: 0.2, max: 0.6 },
    pulseSeconds: 1,
  });
  expect(() => {
    glow.dispose();
    scene.dispose();
    engine.dispose();
  }).not.toThrow();
});

test("a glow with no targets stays disabled instead of lighting the whole scene", () => {
  withScene(scene => {
    const glow = createMeshGlow(scene, "empty-glow", new Mesh("empty-root", scene), {
      glowColor: new Color4(1, 1, 1, 1),
      haloColor: new Color3(1, 1, 1),
      intensity: { min: 1, max: 2 },
      haloAlpha: { min: 0.2, max: 0.6 },
      pulseSeconds: 1,
    });
    const layer = scene.effectLayers.find(candidate => candidate.name === "empty-glow")!;
    expect(layer.isEnabled).toBe(false);

    glow.highlight(null, 0);
    expect(layer.isEnabled).toBe(false);

    // An empty-but-present target list is still a highlight, so the layer turns on with
    // an empty include list rather than an absent one (which would glow everything).
    glow.highlight([], 0);
    expect(layer.isEnabled).toBe(true);
    expect(() => glow.warm([])).not.toThrow();
    glow.dispose();
  });
});
