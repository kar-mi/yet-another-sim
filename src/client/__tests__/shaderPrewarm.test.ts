import { expect, test } from "bun:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FloorAoe } from "@shared/floorAoe";

// Each shader effect first created mid-fight is a synchronous compile (a visible hitch), so the
// material families the Omni Elements pull uses must already be compiled by prewarmShaders.
test("prewarm covers floor telegraphs, element glyphs and element rings", async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const context = new Proxy({}, { get: () => () => ({ width: 1 }), set: () => true });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    baseURI: "http://localhost/",
    removeEventListener: () => {},
    createElement: () => ({ width: 1, height: 1, getContext: () => context }),
  } });
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const { prewarmShaders } = await import("../render/shaderPrewarm");
    const { syncFloorAoeMeshes } = await import("../render/floorAoeSync");
    const { createElementGlyph } = await import("../render/meshes/elementGlyphMeshes");
    const { ElementRingLayer } = await import("../render/ElementRingLayer");
    new ArcRotateCamera("camera", 0, 1, 30, Vector3.Zero(), scene);
    new HemisphericLight("light", new Vector3(0, 1, 0), scene);
    const effects = () => Object.keys((engine as unknown as { _compiledEffects: object })._compiledEffects);

    prewarmShaders(scene);
    scene.render();
    const warmed = new Set(effects());

    const shape = { kind: "circle", center: { x: 0, z: 0 }, radius: 3 } as const;
    syncFloorAoeMeshes(scene, new Map(), [
      new FloorAoe({ id: "fill", shape, color: "#ff0000", resolveMode: { kind: "active" }, resolveAt: 10 }),
      new FloorAoe({ id: "outline", shape, color: "#ff0000", style: "outline", resolveMode: { kind: "active" }, resolveAt: 10 }),
    ], 0, new Set());
    createElementGlyph(scene, "glyph", "fire", "#ff4000", { x: 0, z: 0 });
    new ElementRingLayer(scene).sync([{
      id: "ring", shape, telegraphStart: 0, resolveAt: 2, resolved: false, ring: { center: { x: 0, z: 0 }, radius: 20 },
    } as never], 1);
    scene.render();

    expect(effects().filter(key => !warmed.has(key))).toEqual([]);
  } finally {
    scene.dispose();
    engine.dispose();
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else delete (globalThis as { document?: unknown }).document;
  }
});
