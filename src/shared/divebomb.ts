import { add, length, normalize, scale, sub, type Vec2 } from "./math";

export function divebombLifetime(from: Vec2, to: Vec2, gap: number, speed: number): number {
  const stepCount = Math.ceil(length(sub(to, from)) / gap);
  // Include a full display interval for both the starting slot and the endpoint slot.
  return (stepCount + 1) * gap / speed;
}

// A divebomb occupies one discrete slot at a time. It advances one authored gap every gap/speed
// seconds and includes the exact endpoint as its final slot.
export function divebombPosition(
  from: Vec2,
  to: Vec2,
  gap: number,
  speed: number,
  elapsed: number,
): Vec2 {
  const segment = sub(to, from);
  const segmentLength = length(segment);
  const finalStep = Math.ceil(segmentLength / gap);
  const step = Math.min(Math.floor(Math.max(0, elapsed) * speed / gap), finalStep);
  const distance = Math.min(step * gap, segmentLength);
  return add(from, scale(normalize(segment), distance));
}
