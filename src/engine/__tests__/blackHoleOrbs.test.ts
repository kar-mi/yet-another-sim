import { expect, test } from "bun:test";
import { COMBO_A, rotate90, selectOrbLayout } from "../blackHoleOrbs";

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
