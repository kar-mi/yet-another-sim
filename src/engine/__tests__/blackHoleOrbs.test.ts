import { expect, test } from "bun:test";
import { rotate90, selectOrbLayout, clockwiseTetherOrder, type BlackHoleOrb } from "../blackHoleOrbs";

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

const N = { x: 0, z: 17 };
const E = { x: 17, z: 0 };
const S = { x: 0, z: -17 };
const W = { x: -17, z: 0 };

test("clockwiseTetherOrder sweeps clockwise from the reference boss's bearing", () => {
  // Boss north, orbs at N/E/S: 1st clockwise is N (offset 0), then E (90), then S (180).
  expect(clockwiseTetherOrder([S, E, N], { x: 0, z: 18 })).toEqual([N, E, S]);
  // Same orbs, boss east: sweep starts at E, wraps past the empty S->N gap last.
  expect(clockwiseTetherOrder([S, E, N], { x: 18, z: 0 })).toEqual([E, S, N]);
  // Boss south-west (in the empty gap) with orbs E/S/W: nearest clockwise is W, then wraps to E, S.
  expect(clockwiseTetherOrder([E, S, W], { x: -13, z: -13 })).toEqual([W, E, S]);
});

test("clockwiseTetherOrder is a stable permutation of its input", () => {
  const orbs = [E, S, W];
  for (const from of [N, E, S, W, { x: 13, z: 13 }, { x: -13, z: 13 }]) {
    const ordered = clockwiseTetherOrder(orbs, from);
    expect(ordered).toHaveLength(3);
    expect(new Set(ordered)).toEqual(new Set(orbs));
  }
});
