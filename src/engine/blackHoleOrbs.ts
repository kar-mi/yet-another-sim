import type { Vec2 } from "@shared/math";
import { randomInt } from "@shared/rng";

export type BlackHoleOrb = { pos: Vec2; tether: boolean };

export function rotate90(pos: Vec2, k: number): Vec2 {
  let rotated = pos;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) rotated = { x: rotated.z, z: -rotated.x };
  return rotated;
}

export function selectOrbLayout(combos: readonly (readonly BlackHoleOrb[])[], rngState: number): { orbs: BlackHoleOrb[]; rngState: number; combo: number; rotation: number } {
  const comboRoll = randomInt(rngState, combos.length);
  const rotationRoll = randomInt(comboRoll.state, 4);
  const source = combos[comboRoll.value]!;
  return {
    combo: comboRoll.value,
    rotation: rotationRoll.value,
    rngState: rotationRoll.state,
    orbs: source.map(orb => ({ ...orb, pos: rotate90(orb.pos, rotationRoll.value) })),
  };
}
