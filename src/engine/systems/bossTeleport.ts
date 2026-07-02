import type { PendingBossTeleport } from "@shared/types";
import { atan2 } from "@shared/dmath";
import type { TickContext } from "./context";

export function resolveBossTeleports(ctx: TickContext): PendingBossTeleport[] {
  const remaining: PendingBossTeleport[] = [];
  for (const pending of ctx.world.pendingBossTeleports) {
    if (pending.t > ctx.time) {
      remaining.push(pending);
      continue;
    }
    const boss = ctx.bosses.find(b => b.id === pending.bossId);
    if (!boss) continue;
    const spot = pending.spots[pending.rng ? ctx.randInt(pending.spots.length) : 0]!;
    boss.pos = { ...spot };
    boss.facing = atan2(-spot.x, -spot.z);
    boss.hidden = false;
  }
  return remaining;
}
