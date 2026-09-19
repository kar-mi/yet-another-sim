import { expect, test } from "bun:test";
import { FloorAoe, isFloorAoeVisible, type Vfx } from "@effects";
import { VfxSchema } from "@effects/schema";
import { loadRaid } from "../raidLoader";
import { createWorld } from "../world";
import { noMove, runTicks } from "./helpers";
import type { World } from "@shared/types";

const raw = Bun.YAML.parse(await Bun.file(`${import.meta.dir}/../../../raids/debug/vfx-test.yaml`).text());
const raid = loadRaid(raw);

function mechanicAt(id: string, time: number) {
  let world: World = createWorld(raid, 3);
  world.players.forEach(player => { player.invincible = true; });
  world = runTicks(world, noMove, Math.ceil((time - world.time) * 60));
  return world.active.find(mechanic => mechanic.id === id);
}

test("an AoE with no vfx block carries no overrides", () => {
  const mechanic = mechanicAt("fill-circle", 3)!;
  expect(mechanic.floorAoe).toBeDefined();
  expect(mechanic.floorAoe!.element).toBe("fire");
  expect(mechanic.floorAoe!.vfx).toBeUndefined();
  expect(mechanic.vfx).toBeUndefined();
});

test("floor overrides survive loading and reach the FloorAoe", () => {
  expect(mechanicAt("vfx-floor-off", 39)!.floorAoe!.vfx).toEqual({ floor: { element: false }, burst: undefined });
  expect(mechanicAt("vfx-floor-intense", 42)!.floorAoe!.vfx).toEqual({ floor: { intensity: 2 }, burst: undefined });
});

test("burst overrides survive loading and reach the FloorAoe", () => {
  const vfx = mechanicAt("vfx-burst-outline", 45)!.floorAoe!.vfx!;
  expect(vfx.burst).toEqual({
    enabled: true,
    element: "fire",
    color: "#ff6a1f",
    count: 240,
    size: { min: 0.4, max: 0.9 },
    lifetime: { min: 0.3, max: 0.7 },
  });
  expect(mechanicAt("vfx-burst-off", 48)!.floorAoe!.vfx!.burst).toEqual({ enabled: false });
});

test("glow rides the mechanic, not the floor telegraph", () => {
  const mechanic = mechanicAt("sealed-implements-1-bow", 52)!;
  expect(mechanic.vfx!.glow).toEqual({
    color: "#4fc3ff",
    intensity: { min: 0.4, max: 2.4 },
    pulsePeriod: 0.4,
  });
  // showTelegraph is false, so there is no FloorAoe to carry it.
  expect(mechanic.floorAoe).toBeUndefined();
});

// A deferred cleave rebuilds its FloorAoe when a bait arms it; the overrides must come along.
test("a deferred cleave keeps its element and vfx when armed", () => {
  const deferredRaid = loadRaid({
    name: "Deferred VFX",
    arena: { zones: [{ kind: "circle", center: { x: 0, z: 0 }, radius: 25 }] },
    duration: 30,
    players: raid.players.map(player => ({ id: player.id, role: player.role, spawn: player.spawn })),
    events: [
      {
        type: "aoe", id: "stored", time: 1, name: "Stored", deferred: true,
        anchor: "boss", directionFrom: "bossFacing", telegraph: 3, damage: 0, damageType: "magical",
        shape: { kind: "cone", angleDeg: 180, length: 25 }, element: "ice",
        vfx: { floor: { intensity: 1.5 }, burst: { count: 30 } },
      },
      { type: "bait", id: "bait", time: 4, name: "Bait", targetMode: "closest", telegraph: 2, link: "stored" },
    ],
  });
  let world: World = createWorld(deferredRaid, 3);
  world.players.forEach(player => { player.invincible = true; });
  world = runTicks(world, noMove, Math.ceil(4.5 * 60));

  const stored = world.active.find(mechanic => mechanic.id === "stored")!;
  expect(stored.armed).toBe(true);
  expect(stored.floorAoe!.element).toBe("ice");
  expect(stored.floorAoe!.vfx).toEqual({ floor: { intensity: 1.5 }, burst: { count: 30 } });
});

test("a FloorAoe keeps its overrides and visibility across a JSON round-trip", () => {
  const vfx = { floor: { intensity: 2 }, burst: { enabled: true, count: 10 } };
  const original = new FloorAoe({
    id: "rt", shape: { kind: "circle", center: { x: 1, z: 2 }, radius: 3 },
    color: "#ff0000", element: "fire", vfx,
    resolveMode: { kind: "resolve", lead: 1, trail: 0.5 }, resolveAt: 10,
  });
  const parsed: FloorAoe = JSON.parse(JSON.stringify(original));
  expect(parsed.vfx).toEqual(vfx);
  expect(isFloorAoeVisible(parsed, 9.5, false)).toBe(true);
  expect(isFloorAoeVisible(parsed, 8.5, false)).toBe(false);
  expect(isFloorAoeVisible(parsed, 10.6, true)).toBe(false);
});

test("vfx validation rejects bad colors, ranges and non-finite numbers", () => {
  const ok = (vfx: unknown) => VfxSchema.safeParse(vfx).success;
  expect(ok({ burst: { color: "#ff6a1f" }, glow: { intensity: { min: 1, max: 2 } } })).toBe(true);
  expect(ok({ burst: { color: "red" } })).toBe(false);
  expect(ok({ burst: { color: "#fff" } })).toBe(false);
  expect(ok({ glow: { intensity: { min: 2, max: 1 } } })).toBe(false);
  expect(ok({ glow: { pulsePeriod: 0 } })).toBe(false);
  expect(ok({ floor: { intensity: Number.POSITIVE_INFINITY } })).toBe(false);
  expect(ok({ burst: { count: 1.5 } })).toBe(false);
  expect(ok({ burst: { lifetime: { min: 0, max: 1 } } })).toBe(false);
  expect(ok({ floor: { unknown: 1 } })).toBe(false);
});

test("Vfx splits into the floor-carried half and the mechanic-carried half", () => {
  const vfx: Vfx = { floor: { intensity: 2 }, glow: { color: "#ffffff" } };
  expect(vfx.glow).toBeDefined();
  expect(VfxSchema.safeParse(vfx).success).toBe(true);
});
