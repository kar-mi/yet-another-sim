import { expect, test } from "bun:test";
import { COMBO_A, COMBO_B, rotate90, selectOrbLayout } from "../blackHoleOrbs";

test("rotate90 maps relative-north cardinals clockwise", () => {
  expect(rotate90({ x: 0, z: 18 }, 1).x).toBeCloseTo(18);
  expect(rotate90({ x: 0, z: 18 }, 1).z).toBeCloseTo(0);
  expect(rotate90({ x: 18, z: 0 }, 1)).toEqual({ x: 0, z: -18 });
  expect(rotate90({ x: 0, z: -18 }, 1).x).toBeCloseTo(-18);
  expect(rotate90({ x: 0, z: -18 }, 1).z).toBeCloseTo(0);
  expect(rotate90({ x: -18, z: 0 }, 1)).toEqual({ x: 0, z: 18 });
});

test("selectOrbLayout is deterministic for a fixed seed", () => {
  expect(selectOrbLayout(12345)).toEqual(selectOrbLayout(12345));
  expect(selectOrbLayout(12345).orbs).toHaveLength(COMBO_A.length);
  expect(selectOrbLayout(12345).orbs.filter(orb => orb.tether)).toHaveLength(3);
});

test("black hole orb combos match the reference spot maps", () => {
  expect(COMBO_A.map(orb => orb.pos)).toEqual([
    { x: 0, z: 17 }, { x: 17, z: 0 }, { x: 0, z: -17 },
    { x: 5, z: 13 }, { x: -7, z: 7 }, { x: 7, z: 7 }, { x: -13, z: 5 },
    { x: 13, z: -5 }, { x: -7, z: -7 }, { x: 6, z: -7 }, { x: -6, z: -13 },
  ]);
  expect(COMBO_B.map(orb => orb.pos)).toEqual([
    { x: 0, z: 17 }, { x: 17, z: 0 }, { x: 0, z: -17 },
    { x: -13, z: 5 }, { x: -9, z: 0 }, { x: 0, z: 9 }, { x: 6, z: 13 },
    { x: 9, z: 0 }, { x: 13, z: -6 }, { x: 0, z: -9 }, { x: -5, z: -13 },
  ]);
});
