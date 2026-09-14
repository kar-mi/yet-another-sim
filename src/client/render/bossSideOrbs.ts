import type { ActiveMechanic, PendingEvent, World } from "@shared/types";

export type BossSideOrbColors = { leftColor?: string; rightColor?: string };

export function selectBossSideOrbs(world: World): Map<string, BossSideOrbColors> {
  const pendingTeleports = new Set(world.pendingBossTeleports.map(teleport => teleport.id));
  const byBoss = new Map<string, BossSideOrbColors>();

  const add = (source: PendingEvent | ActiveMechanic): void => {
    const { sideOrbAfter, bossId, color, directionOffset } = source;
    if (sideOrbAfter === undefined || bossId === undefined || color === undefined || directionOffset === undefined) return;
    if (pendingTeleports.has(sideOrbAfter)) return;
    const colors = byBoss.get(bossId) ?? {};
    colors[directionOffset < 0 ? "leftColor" : "rightColor"] = color;
    byBoss.set(bossId, colors);
  };

  for (const event of world.pending) add(event);
  for (const mechanic of world.active) {
    if (!mechanic.resolved) add(mechanic);
  }
  return byBoss;
}
