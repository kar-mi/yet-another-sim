import type { Vec2 } from "@shared/math";
import { randomInt } from "@shared/rng";

export type BlackHoleOrb = { pos: Vec2; tether: boolean };

export const COMBO_A: readonly BlackHoleOrb[] = [
  { pos: { x: 0, z: 17 }, tether: true },
  { pos: { x: 17, z: 0 }, tether: true },
  { pos: { x: 0, z: -17 }, tether: true },
  { pos: { x: 5, z: 13 }, tether: false },
  { pos: { x: -7, z: 7 }, tether: false },
  { pos: { x: 7, z: 7 }, tether: false },
  { pos: { x: -13, z: 5 }, tether: false },
  { pos: { x: 13, z: -5 }, tether: false },
  { pos: { x: -7, z: -7 }, tether: false },
  { pos: { x: 6, z: -7 }, tether: false },
  { pos: { x: -6, z: -13 }, tether: false },
];

export const COMBO_B: readonly BlackHoleOrb[] = [
  { pos: { x: 0, z: 17 }, tether: true },
  { pos: { x: 17, z: 0 }, tether: true },
  { pos: { x: 0, z: -17 }, tether: true },
  { pos: { x: -13, z: 5 }, tether: false },
  { pos: { x: -9, z: 0 }, tether: false },
  { pos: { x: 0, z: 9 }, tether: false },
  { pos: { x: 6, z: 13 }, tether: false },
  { pos: { x: 9, z: 0 }, tether: false },
  { pos: { x: 13, z: -6 }, tether: false },
  { pos: { x: 0, z: -9 }, tether: false },
  { pos: { x: -5, z: -13 }, tether: false },
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
