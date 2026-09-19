import { afterAll, beforeAll, expect, test } from "bun:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { FloorAoe, type FloorAoeVfx } from "@effects";
import type { ActiveMechanic } from "@shared/types";
import { TelegraphLayer } from "../render/TelegraphLayer";

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

const RESOLVE_AT = 10;

function mechanic(options: { outline?: boolean; element?: "fire" | "ice"; vfx?: FloorAoeVfx }): ActiveMechanic {
  const shape = { kind: "circle", center: { x: 0, z: 0 }, radius: 4 } as const;
  return {
    id: "burst-me",
    name: "Burst Me",
    shape,
    telegraphStart: 0,
    resolveAt: RESOLVE_AT,
    damage: 0,
    damageType: "magical",
    resolved: false,
    showCastBar: false,
    showTelegraph: true,
    floorAoe: new FloorAoe({
      id: "burst-me", shape, color: "#ff2200",
      ...(options.outline ? { style: "outline" as const } : {}),
      ...(options.element ? { element: options.element } : {}),
      ...(options.vfx ? { vfx: options.vfx } : {}),
      resolveMode: { kind: "active" }, resolveAt: RESOLVE_AT,
    }),
  };
}

function burstCount(scene: Scene): number {
  return scene.particleSystems.filter(ps => ps.name.startsWith("element-burst-")).length;
}

function withLayer<T>(run: (layer: TelegraphLayer, scene: Scene) => T): T {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    return run(new TelegraphLayer(scene), scene);
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

test("a filled element AoE bursts once at its resolve", () => {
  withLayer((layer, scene) => {
    const active = [mechanic({ element: "fire" })];
    layer.sync(active, 9);
    expect(burstCount(scene)).toBe(0);
    layer.sync(active, RESOLVE_AT);
    expect(burstCount(scene)).toBe(1);
    layer.sync(active, RESOLVE_AT + 0.1);
    expect(burstCount(scene)).toBe(1);
  });
});

test("an outlined AoE stays quiet unless vfx.burst enables it", () => {
  withLayer((layer, scene) => {
    layer.sync([mechanic({ outline: true, element: "fire" })], RESOLVE_AT);
    expect(burstCount(scene)).toBe(0);
  });
  withLayer((layer, scene) => {
    layer.sync([mechanic({ outline: true, element: "fire", vfx: { burst: { enabled: true } } })], RESOLVE_AT);
    expect(burstCount(scene)).toBe(1);
  });
});

test("vfx.burst.enabled false suppresses a burst that would otherwise fire", () => {
  withLayer((layer, scene) => {
    layer.sync([mechanic({ element: "fire", vfx: { burst: { enabled: false } } })], RESOLVE_AT);
    expect(burstCount(scene)).toBe(0);
  });
});

test("vfx.burst.element bursts with an element the floor does not have", () => {
  withLayer((layer, scene) => {
    layer.sync([mechanic({ vfx: { burst: { enabled: true, element: "ice" } } })], RESOLVE_AT);
    expect(scene.particleSystems.filter(ps => ps.name === "element-burst-ice")).toHaveLength(1);
  });
});

test("vfx.burst.count drives how many particles are emitted", () => {
  withLayer((layer, scene) => {
    layer.sync([mechanic({ element: "fire", vfx: { burst: { count: 17 } } })], RESOLVE_AT);
    const burst = scene.particleSystems.find(ps => ps.name === "element-burst-fire")!;
    expect(burst.manualEmitCount).toBe(17);
  });
});

test("a replay seek backwards lets the same AoE burst again", () => {
  withLayer((layer, scene) => {
    const active = [mechanic({ element: "fire" })];
    layer.sync(active, RESOLVE_AT);
    expect(burstCount(scene)).toBe(1);
    // Seek back before the hit, then play forward through it again.
    layer.sync(active, 5);
    layer.sync(active, RESOLVE_AT);
    expect(burstCount(scene)).toBe(2);
  });
});

test("a burst is skipped when the seek lands long after the hit", () => {
  withLayer((layer, scene) => {
    layer.sync([mechanic({ element: "fire" })], RESOLVE_AT + 5);
    expect(burstCount(scene)).toBe(0);
  });
});
