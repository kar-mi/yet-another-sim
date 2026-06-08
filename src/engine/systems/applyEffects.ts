// Phase 3e: apply-effect events. Drop a buff/debuff straight onto players (all / by role / by id /
// by count, optionally a random subset).

import type { TickContext } from "./context";
import type { PendingApplyEffect } from "../../shared/types";
import { applyEffect } from "./helpers";

export function resolveApplyEffects(ctx: TickContext): PendingApplyEffect[] {
  const { players, log, time, randInt } = ctx;
  const remaining: PendingApplyEffect[] = [];
  for (const pae of ctx.world.pendingApplyEffects) {
    if (pae.t > time) {
      remaining.push(pae);
      continue;
    }
    let pool = players.filter(p => p.alive);
    if (pae.players) {
      const ids = new Set(pae.players);
      pool = pool.filter(p => ids.has(p.id));
    } else if (pae.role) {
      pool = pool.filter(p => p.role === pae.role);
    }
    if (pae.count !== undefined && pae.count < pool.length) {
      if (pae.rng) {
        const shuffled = pool.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = randInt(i + 1);
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        pool = shuffled;
      }
      pool = pool.slice(0, pae.count);
    }
    for (const target of pool) {
      applyEffect(target, pae.applyEffect, time, `${pae.name}-${target.id}-eff`, players);
      log.push({ t: time, mechanic: pae.name, playerId: target.id, event: "hit" });
    }
  }
  return remaining;
}
