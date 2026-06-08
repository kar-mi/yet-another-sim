// Phase 2: tether sources. Promote pending tethers, keep their attachment pointed at the nearest
// living player, allow interception before finalization, then finalize into a buff/debuff effect.

import type { TickContext } from "./context";
import type { TetherSource, PendingTether } from "../../shared/types";
import { selectTargetPlayer, findInterceptor, applyEffect } from "./helpers";

export function resolveTethers(ctx: TickContext): {
  tetherSources: TetherSource[];
  pendingTethers: PendingTether[];
} {
  const { players, log, time } = ctx;
  let tetherSources: TetherSource[] = ctx.world.tetherSources.map(ts => ({ ...ts }));
  const remainingPendingTethers: PendingTether[] = [];
  for (const pt of ctx.world.pendingTethers) {
    if (pt.t <= time) {
      const nearest = selectTargetPlayer(players, pt.pos, "closest");
      tetherSources.push({
        id: pt.id,
        pos: pt.pos,
        spawnAt: pt.t,
        finalizeAt: pt.t + pt.finalizeAfter,
        tetherKind: pt.tetherKind,
        buffName: pt.buffName,
        behavior: pt.behavior,
        effectDuration: pt.effectDuration,
        icon: pt.icon,
        tetheredPlayerId: nearest?.id ?? null,
        finalized: false,
      });
    } else {
      remainingPendingTethers.push(pt);
    }
  }

  for (const ts of tetherSources) {
    if (ts.finalized) continue;

    // Re-attach if current target is dead
    if (ts.tetheredPlayerId) {
      const target = players.find(p => p.id === ts.tetheredPlayerId);
      if (!target?.alive) ts.tetheredPlayerId = selectTargetPlayer(players, ts.pos, "closest")?.id ?? null;
    } else {
      ts.tetheredPlayerId = selectTargetPlayer(players, ts.pos, "closest")?.id ?? null;
    }

    // Check for interceptions (only before finalization)
    if (ts.tetheredPlayerId && time < ts.finalizeAt) {
      const target = players.find(p => p.id === ts.tetheredPlayerId)!;
      const interceptor = findInterceptor(players, ts.pos, target.pos, ts.tetheredPlayerId);
      if (interceptor) ts.tetheredPlayerId = interceptor.id;
    }

    // Finalize
    if (time >= ts.finalizeAt) {
      ts.finalized = true;
      const target = players.find(p => p.id === ts.tetheredPlayerId);
      if (target) {
        applyEffect(target, {
          name: ts.buffName,
          kind: ts.tetherKind,
          duration: ts.effectDuration,
          behavior: ts.behavior,
          icon: ts.icon,
        }, time, `${ts.id}-effect`, players);
        log.push({ t: time, mechanic: ts.buffName, playerId: target.id, event: ts.tetherKind === "buff" ? "cleared" : "hit" });
      }
    }
  }

  // Cull sources finalized more than 2s ago
  tetherSources = tetherSources.filter(ts => !ts.finalized || ts.finalizeAt > time - 2);
  return { tetherSources, pendingTethers: remainingPendingTethers };
}
