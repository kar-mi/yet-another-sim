import type { TickContext } from "./context";
import type { PendingSetHp } from "@model/types";

export function resolveSetHps(ctx: TickContext): PendingSetHp[] {
  const { players, log, time } = ctx;
  const remaining: PendingSetHp[] = [];
  for (const psh of ctx.world.pendingSetHps) {
    if (psh.t > time) {
      remaining.push(psh);
      continue;
    }
    let pool = players.filter(p => p.alive);
    if (psh.players) {
      const ids = new Set(psh.players);
      pool = pool.filter(p => ids.has(p.id));
    } else if (psh.role) {
      pool = pool.filter(p => p.role === psh.role);
    }
    for (const target of pool) {
      target.hp = Math.min(target.maxHp, psh.amount);
      log.push({ t: time, mechanic: psh.name, playerId: target.id, event: "hit" });
    }
  }
  return remaining;
}
