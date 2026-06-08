// Small shared utilities folding the two boilerplate shapes that repeat identically across the
// per-mechanic systems. Only the truly uniform parts are abstracted here; the divergent resolution
// bodies (gaze cones, inverse shapes, tower roles, spread/stack, etc.) stay inline in each system.

// Split a pending list into events due this tick (t <= time) and those still in the future,
// preserving order. Replaces the manual "push to remaining" loop in every promote pass.
export function partitionDue<T extends { t: number }>(
  items: T[],
  time: number,
): { due: T[]; remaining: T[] } {
  const due: T[] = [];
  const remaining: T[] = [];
  for (const item of items) {
    if (item.t <= time) due.push(item);
    else remaining.push(item);
  }
  return { due, remaining };
}

// Keep an active mechanic if it is unresolved, or it resolved recently enough to still flash its
// outcome (within `lingerFor` seconds). Replaces the identical tail filter in the AOE / tower /
// group / inverse / spread-stack / gaze resolution passes.
export function cullResolved<T extends { resolved: boolean; resolveAt: number }>(
  items: T[],
  time: number,
  lingerFor: number,
): T[] {
  return items.filter(item => !item.resolved || item.resolveAt >= time - lingerFor);
}
