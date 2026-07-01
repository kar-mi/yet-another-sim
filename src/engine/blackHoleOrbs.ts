import type { Vec2 } from "@shared/math";
import { randomInt } from "@shared/rng";

export type BlackHoleOrb = { pos: Vec2; tether: boolean };

export const COMBO_A: readonly BlackHoleOrb[] = [
  { pos: { x: 0, z: 18 }, tether: true },
  { pos: { x: 18, z: 0 }, tether: true },
  { pos: { x: 0, z: -18 }, tether: true },
  { pos: { x: -9, z: 11 }, tether: false },
  { pos: { x: 8, z: 10 }, tether: false },
  { pos: { x: -13, z: 2 }, tether: false },
  { pos: { x: 12, z: -4 }, tether: false },
  { pos: { x: -7, z: -10 }, tether: false },
  { pos: { x: 5, z: -12 }, tether: false },
  { pos: { x: 0, z: 5 }, tether: false },
  { pos: { x: 3, z: -2 }, tether: false },
];

export const COMBO_B: readonly BlackHoleOrb[] = [
  { pos: { x: 0, z: 18 }, tether: true },
  { pos: { x: 18, z: 0 }, tether: true },
  { pos: { x: 0, z: -18 }, tether: true },
  { pos: { x: -11, z: 9 }, tether: false },
  { pos: { x: 11, z: 8 }, tether: false },
  { pos: { x: -14, z: -2 }, tether: false },
  { pos: { x: 14, z: 2 }, tether: false },
  { pos: { x: -5, z: -12 }, tether: false },
  { pos: { x: 8, z: -9 }, tether: false },
  { pos: { x: -2, z: 4 }, tether: false },
  { pos: { x: 4, z: -3 }, tether: false },
];

export function rotate90(pos: Vec2, k: number): Vec2 {
  let rotated = pos;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) rotated = { x: rotated.z, z: -rotated.x };
  return rotated;
}

export function selectOrbLayout(rngState: number): { orbs: BlackHoleOrb[]; rngState: number; combo: "A" | "B"; rotation: number } {
  const comboRoll = randomInt(rngState, 2);
  const rotationRoll = randomInt(comboRoll.state, 4);
  const combo = comboRoll.value === 0 ? "A" : "B";
  const source = combo === "A" ? COMBO_A : COMBO_B;
  return {
    combo,
    rotation: rotationRoll.value,
    rngState: rotationRoll.state,
    orbs: source.map(orb => ({ ...orb, pos: rotate90(orb.pos, rotationRoll.value) })),
  };
}
