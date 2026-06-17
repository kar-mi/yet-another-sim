import type { TickContext } from "./context";
import type { PendingLimitCut } from "@shared/types";
import { applyEffect } from "./helpers";

export function resolveLimitCuts(ctx: TickContext): PendingLimitCut[] {
  const { players, log, time, randInt } = ctx;
  const remaining: PendingLimitCut[] = [];
  for (const plc of ctx.world.pendingLimitCuts) {
    if (plc.t > time) { remaining.push(plc); continue; }
    let pool = players.filter(p => p.alive);
    if (plc.players) {
      const ids = new Set(plc.players);
      pool = pool.filter(p => ids.has(p.id));
    } else if (plc.role) {
      pool = pool.filter(p => p.role === plc.role);
    }
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (let i = 0; i < shuffled.length; i++) {
      const target = shuffled[i];
      applyEffect(target, { ...plc.effect, markerIcon: `limit${i + 1}_head.png` }, time, `${plc.id}-${target.id}-lc`, players);
      log.push({ t: time, mechanic: plc.name, playerId: target.id, event: "hit" });
    }
  }
  return remaining;
}
