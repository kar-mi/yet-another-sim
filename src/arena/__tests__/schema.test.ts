import { expect, test } from "bun:test";
import { ArenaSchema, ZoneShapeSchema } from "@arena/schema";

test("inline arenas normalize vectors into canonical arena objects", () => {
  const arena = ArenaSchema.parse({
    zones: [
      { kind: "circle", center: [1, 2], radius: 10 },
      { kind: "rect", center: { x: 3, z: 4 }, width: 5, height: 6 },
    ],
  });
  expect(arena).toEqual({
    zones: [
      { kind: "circle", center: { x: 1, z: 2 }, radius: 10 },
      { kind: "rect", center: { x: 3, z: 4 }, width: 5, height: 6 },
    ],
    floorPlan: "squares",
  });
});

test("generated arenas resolve to the same canonical zones as the package generator", () => {
  const arena = ArenaSchema.parse({ generator: "index_arena_1", floorPlan: { color: "#1f3852" } });
  expect(arena.zones).toHaveLength(9);
  expect(arena.zones.every(zone => zone.kind === "polygon")).toBe(true);
  expect(arena.floorPlan).toEqual({ color: "#1f3852" });
});

test("an arena requires exactly one zone source", () => {
  const zones = [{ kind: "circle", center: [0, 0], radius: 20 }];
  expect(ArenaSchema.safeParse({}).success).toBe(false);
  expect(ArenaSchema.safeParse({ zones, generator: "index_arena_1" }).success).toBe(false);
});

test("arena dimensions, colors, and image ids are validated", () => {
  expect(ZoneShapeSchema.safeParse({ kind: "circle", center: [0, 0], radius: 0 }).success).toBe(false);
  expect(ZoneShapeSchema.safeParse({ kind: "polygon", vertices: [[0, 0], [1, 0]], image: "index-square" }).success).toBe(false);
  expect(ZoneShapeSchema.safeParse({ kind: "polygon", vertices: [[0, 0], [1, 0], [0, 1]], image: "unknown" }).success).toBe(false);
  expect(ArenaSchema.safeParse({ zones: [{ kind: "circle", center: [0, 0], radius: 1 }], floorPlan: { color: "blue" } }).success).toBe(false);
});
