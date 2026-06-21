import { add, length, normalize, scale, sub, type Vec2 } from "./math";

// A divebomb occupies one discrete slot at a time. It advances one authored gap every gap/speed
// seconds, includes the exact endpoint as its final slot, then wraps to the start for long durations.
export function divebombPosition(
  from: Vec2,
  to: Vec2,
  gap: number,
  speed: number,
  elapsed: number,
): Vec2 {
  const segment = sub(to, from);
  const segmentLength = length(segment);
  const slotCount = Math.ceil(segmentLength / gap) + 1;
  const step = Math.floor(Math.max(0, elapsed) * speed / gap) % slotCount;
  const distance = Math.min(step * gap, segmentLength);
  return add(from, scale(normalize(segment), distance));
}
