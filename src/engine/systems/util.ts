export function cullResolved<T extends { resolved: boolean; resolveAt: number }>(
  items: T[],
  time: number,
  lingerFor: number,
): T[] {
  return items.filter(item => !item.resolved || item.resolveAt >= time - lingerFor);
}
