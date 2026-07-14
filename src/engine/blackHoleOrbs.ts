import type { Vec2 } from "@shared/math";
import { randomInt } from "@shared/rng";
import { atan2 } from "@shared/dmath";

export type BlackHoleOrb = { pos: Vec2; tether: boolean };

export function rotate90(pos: Vec2, k: number): Vec2 {
  let rotated = pos;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) rotated = { x: rotated.z, z: -rotated.x };
  return rotated;
}

// Bearing of a point around arena centre: 0 at north (+z), increasing clockwise toward +x (east),
// matching the boss-facing convention (atan2(x, z)) used elsewhere in the engine.
const TAU = 2 * Math.PI;
function bearing(pos: Vec2): number {
  return atan2(pos.x, pos.z);
}

// Order the tether orbs by their clockwise angular offset from `from`'s bearing: the first orb
// encountered sweeping clockwise from the reference boss comes first (slot 0), then the next, etc.
// Ties (a coincident bearing) break by ascending absolute bearing for determinism.
export function clockwiseTetherOrder(positions: readonly Vec2[], from: Vec2): Vec2[] {
  const base = bearing(from);
  const offset = (pos: Vec2) => ((bearing(pos) - base) % TAU + TAU) % TAU;
  return [...positions].sort((a, b) => offset(a) - offset(b) || bearing(a) - bearing(b));
}

export function selectOrbLayout(combos: readonly (readonly BlackHoleOrb[])[], rngState: number, forcedCombo?: number, forcedRotation?: number): { orbs: BlackHoleOrb[]; rngState: number; combo: number; rotation: number } {
  const comboRoll = randomInt(rngState, combos.length);
  const rotationRoll = randomInt(comboRoll.state, 4);
  const combo = forcedCombo ?? comboRoll.value;
  const rotation = forcedRotation ?? rotationRoll.value;
  const source = combos[combo]!;
  return {
    combo,
    rotation,
    rngState: rotationRoll.state,
    orbs: source.map(orb => ({ ...orb, pos: rotate90(orb.pos, rotation) })),
  };
}
