import type { ElementRing } from "./types";

// Grow from zero at cast start to the full radius at resolve.
export function elementRingRadius(ring: ElementRing, telegraphStart: number, resolveAt: number, time: number): number {
  const span = resolveAt - telegraphStart;
  const progress = span > 0 ? Math.min(1, Math.max(0, (time - telegraphStart) / span)) : 1;
  return ring.radius * progress;
}
