import { expect, test } from "bun:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";

test.each([false, true])("disposing Index releases resources (images loaded: %s)", async loaded => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
  const images: { onload?: () => void }[] = [];
  let draws = 0;
  const context = {
    drawImage: () => { draws++; },
    fillRect: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} }),
    setTransform: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4 * 4 * 4).fill(255) }),
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    baseURI: "http://localhost/",
    removeEventListener: () => {},
    createElement: () => ({ width: 1, height: 1, getContext: () => context }),
  } });
  Object.defineProperty(globalThis, "Image", { configurable: true, value: class {
    constructor() { images.push(this); }
    width = 4;
    height = 4;
    onload?: () => void;
  } });
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const { buildIndexModel } = await import("../render/meshes/indexModel");
    void scene.defaultMaterial;
    const baseline = { meshes: scene.meshes.length, materials: scene.materials.length, textures: scene.textures.length };
    const model = buildIndexModel(scene, "test-index");
    if (loaded) {
      for (const image of images) image.onload?.();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(draws).toBeGreaterThan(0);
    }
    expect(scene.materials.length).toBeGreaterThan(baseline.materials);
    expect(scene.textures.length).toBeGreaterThan(baseline.textures);
    model.dispose();
    expect(scene.meshes.length).toBe(baseline.meshes);
    expect(scene.materials.length).toBe(baseline.materials);
    expect(scene.textures.length).toBe(baseline.textures);
    const drawsBefore = draws;
    if (!loaded) for (const image of images) image.onload?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(draws).toBe(drawsBefore);
    expect(scene.meshes.length).toBe(baseline.meshes);
  } finally {
    scene.dispose();
    engine.dispose();
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalImage) Object.defineProperty(globalThis, "Image", originalImage);
    else Reflect.deleteProperty(globalThis, "Image");
  }
});
