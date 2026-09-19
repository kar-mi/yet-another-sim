import { afterAll, beforeAll, expect, test } from "bun:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { FloorAoe } from "@effects";
import { createMeshGlow, disposeFloorTelegraphs, syncFloorTelegraphs, type FloorTelegraphMap } from "@effects/babylon";

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
  const meshes: FloorTelegraphMap = new Map();
  syncFloorTelegraphs(scene, meshes, [aoe("warm-up")], 0, new Set());
  disposeFloorTelegraphs(meshes);
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
    const meshes: FloorTelegraphMap = new Map();
    for (let i = 0; i < 20; i++) {
      syncFloorTelegraphs(scene, meshes, [aoe("cycle")], 0, new Set());
      expect(meshes.size).toBe(1);
      syncFloorTelegraphs(scene, meshes, [], 0, new Set());
      expect(meshes.size).toBe(0);
    }
    expect(scene.meshes.length).toBe(baseline.meshes);
    expect(scene.materials.length).toBe(baseline.materials);
  });
});

test("outlined AoEs dispose their fill and its material with the outline", () => {
  withScene(scene => {
    const baseline = warmUp(scene);
    const meshes: FloorTelegraphMap = new Map();
    const outlined = new FloorAoe({
      id: "outlined",
      shape: { kind: "donut", center: { x: 0, z: 0 }, inner: 2, outer: 5 },
      color: "#00ff00", style: "outline",
      resolveMode: { kind: "active" }, resolveAt: 10,
    });
    syncFloorTelegraphs(scene, meshes, [outlined], 0, new Set());
    expect(scene.meshes.length).toBeGreaterThan(baseline.meshes);
    disposeFloorTelegraphs(meshes);
    expect(scene.meshes.length).toBe(baseline.meshes);
    expect(scene.materials.length).toBe(baseline.materials);
  });
});

test("simultaneous element AoEs share one pattern material, and it survives removing one", () => {
  withScene(scene => {
    const meshes: FloorTelegraphMap = new Map();
    syncFloorTelegraphs(scene, meshes, [aoe("a", "fire"), aoe("b", "fire"), aoe("c", "ice")], 0, new Set());
    const fireA = meshes.get("a")!.mesh.material;
    const fireB = meshes.get("b")!.mesh.material;
    const ice = meshes.get("c")!.mesh.material;
    expect(fireA).toBe(fireB!);
    expect(fireA).not.toBe(ice!);

    // Dropping one fire AoE must not dispose the material the other is still drawing with.
    syncFloorTelegraphs(scene, meshes, [aoe("b", "fire")], 0, new Set());
    expect(meshes.get("b")!.mesh.material).toBe(fireA!);
    expect(scene.materials).toContain(fireA!);
  });
});

test("scene teardown after effects are live does not throw", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const meshes: FloorTelegraphMap = new Map();
  syncFloorTelegraphs(scene, meshes, [aoe("live", "fire"), aoe("plain")], 0, new Set());
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

    // An empty list must read as "nothing highlighted", exactly like null.
    glow.highlight([], 0);
    expect(layer.isEnabled).toBe(false);
    expect(() => glow.warm([])).not.toThrow();
    glow.dispose();
  });
});

test("disposing a glow takes its halo mesh, material and texture with it", () => {
  withScene(scene => {
    const root = new Mesh("disposed-root", scene);
    warmUp(scene);
    const before = {
      meshes: scene.meshes.length,
      materials: scene.materials.length,
      textures: scene.textures.length,
    };
    const glow = createMeshGlow(scene, "disposed-glow", root, {
      glowColor: new Color4(1, 1, 1, 1),
      haloColor: new Color3(1, 1, 1),
      intensity: { min: 1, max: 2 },
      haloAlpha: { min: 0.2, max: 0.6 },
      pulseSeconds: 1,
    });
    expect(scene.meshes.length).toBeGreaterThan(before.meshes);
    glow.dispose();
    // The root mesh is the caller's; only the halo belongs to the handle.
    expect(scene.meshes.length).toBe(before.meshes);
    expect(scene.materials.length).toBe(before.materials);
    expect(scene.textures.length).toBe(before.textures);
    expect(scene.effectLayers.some(layer => layer.name === "disposed-glow")).toBe(false);
  });
});
