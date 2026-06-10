// Small shared utilities folding the two boilerplate shapes that repeat identically across the
// per-mechanic systems. Only the truly uniform parts are abstracted here; the divergent resolution
// bodies (gaze cones, inverse shapes, tower roles, spread/stack, etc.) stay inline in each system.

// Keep an active mechanic if it is unresolved, or it resolved recently enough to still flash its
// outcome (within `lingerFor` seconds).
export function cullResolved<T extends { resolved: boolean; resolveAt: number }>(
  items: T[],
  time: number,
  lingerFor: number,
): T[] {
  return items.filter(item => !item.resolved || item.resolveAt >= time - lingerFor);
}
