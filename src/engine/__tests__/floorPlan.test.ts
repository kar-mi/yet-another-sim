import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { baseRaid, loadRaid } from "./helpers";

test("color floor plans survive raid loading and world creation", () => {
  for (const color of ["#1f3852", "#FF0088", "#000000"]) {
    const raid = loadRaid({ ...baseRaid, arena: { ...baseRaid.arena, floorPlan: { color } } });
    expect(createWorld(raid).arena.floorPlan).toEqual({ color });
  }
});

test("color floor plans reject invalid colors", () => {
  for (const color of ["blue", "#abc", "#12345g", "123456", ""]) {
    expect(() => loadRaid({ ...baseRaid, arena: { ...baseRaid.arena, floorPlan: { color } } })).toThrow();
  }
});

test("named floor plans and the default remain supported", () => {
  for (const floorPlan of ["squares", "dmu-p1", "dmu-p2"] as const) {
    const raid = loadRaid({ ...baseRaid, arena: { ...baseRaid.arena, floorPlan } });
    expect(createWorld(raid).arena.floorPlan).toBe(floorPlan);
  }
  expect(createWorld(loadRaid(baseRaid)).arena.floorPlan).toBe("squares");
});
