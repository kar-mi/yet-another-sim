import type { ElementRing } from "./types";

// Radius of an ElementRing at `time`: grows linearly from 0 at cast start to `ring.radius` at resolve.
export function elementRingRadius(ring: ElementRing, telegraphStart: number, resolveAt: number, time: number): number {
  const span = resolveAt - telegraphStart;
  const progress = span > 0 ? Math.min(1, Math.max(0, (time - telegraphStart) / span)) : 1;
  return ring.radius * progress;
}
