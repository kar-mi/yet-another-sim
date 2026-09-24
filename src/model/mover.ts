import type { Vec2 } from "@shared/math";
import type { Mover } from "./types";

export function moverPosition(mover: Mover, to: Vec2, resolveAt: number, time: number): Vec2 {
  const span = resolveAt - mover.departAt;
  const progress = span > 0 ? Math.min(1, Math.max(0, (time - mover.departAt) / span)) : 1;
  return {
    x: mover.from.x + (to.x - mover.from.x) * progress,
    z: mover.from.z + (to.z - mover.from.z) * progress,
  };
}
