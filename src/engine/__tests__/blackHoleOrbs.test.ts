import { expect, test } from "bun:test";
import { rotate90, selectOrbLayout, type BlackHoleOrb } from "../blackHoleOrbs";

const combos: BlackHoleOrb[][] = [[
  { pos: { x: 0, z: 17 }, tether: true },
  { pos: { x: 17, z: 0 }, tether: true },
  { pos: { x: 0, z: -17 }, tether: true },
  { pos: { x: 5, z: 13 }, tether: false },
], [
  { pos: { x: 0, z: 17 }, tether: true },
  { pos: { x: 17, z: 0 }, tether: true },
  { pos: { x: 0, z: -17 }, tether: true },
  { pos: { x: -13, z: 5 }, tether: false },
]];

test("rotate90 maps relative-north cardinals clockwise", () => {
  expect(rotate90({ x: 0, z: 18 }, 1).x).toBeCloseTo(18);
  expect(rotate90({ x: 0, z: 18 }, 1).z).toBeCloseTo(0);
  expect(rotate90({ x: 18, z: 0 }, 1)).toEqual({ x: 0, z: -18 });
  expect(rotate90({ x: 0, z: -18 }, 1).x).toBeCloseTo(-18);
  expect(rotate90({ x: 0, z: -18 }, 1).z).toBeCloseTo(0);
  expect(rotate90({ x: -18, z: 0 }, 1)).toEqual({ x: 0, z: 18 });
});

test("selectOrbLayout is deterministic for a fixed seed", () => {
  expect(selectOrbLayout(combos, 12345)).toEqual(selectOrbLayout(combos, 12345));
  expect(selectOrbLayout(combos, 12345).orbs).toHaveLength(combos[0]!.length);
  expect(selectOrbLayout(combos, 12345).orbs.filter(orb => orb.tether)).toHaveLength(3);
});
