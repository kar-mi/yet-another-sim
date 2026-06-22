import type { TickContext } from "./context";
import type { ActiveLimitCut, PendingLimitCut } from "@shared/types";
import { applyEffect } from "./helpers";

export function resolveLimitCuts(ctx: TickContext): { remaining: PendingLimitCut[]; limitCuts: ActiveLimitCut[] } {
  const { players, log, time, randInt } = ctx;
  const remaining: PendingLimitCut[] = [];
  const limitCuts: ActiveLimitCut[] = ctx.world.limitCuts.slice();
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
      applyEffect(target, { ...plc.effect, markerIcon: `limit${i + 1}_head.png` }, time, `${plc.id}-${target.id}-lc`, players, undefined, i + 1);
      log.push({ t: time, mechanic: plc.name, playerId: target.id, event: "hit" });
    }
    // Surface the fired limit cut so bot-solver rules can gate on it via when.mechanic.
    limitCuts.push({ id: plc.id, appliedAt: time, duration: plc.effect.duration, north: plc.rotation.north, clockwise: plc.rotation.clockwise });
  }
  return { remaining, limitCuts };
}
