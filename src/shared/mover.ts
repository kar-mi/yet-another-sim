import type { Vec2 } from "./math";
import type { Mover } from "./types";

// Where a Mover is at `time`: parked at `from` until `departAt`, then a straight line to `to`,
// arriving exactly at `resolveAt`.
export function moverPosition(mover: Mover, to: Vec2, resolveAt: number, time: number): Vec2 {
  const span = resolveAt - mover.departAt;
  const progress = span > 0 ? Math.min(1, Math.max(0, (time - mover.departAt) / span)) : 1;
  return {
    x: mover.from.x + (to.x - mover.from.x) * progress,
    z: mover.from.z + (to.z - mover.from.z) * progress,
  };
}
