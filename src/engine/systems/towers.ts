// Phase 3c: soak towers. Track live valid soakers each tick; at resolve, reward soakers (or punish
// wrong-role ones) on success, or hit the whole raid with failure damage when undersoaked.

import type { TickContext } from "./context";
import type { ActiveTower, PendingTower, AOEShape, Player } from "@shared/types";
import { pointInShape } from "../shapes";
import { applyEffect, applyKnockback, applyMechanicDamage, applyMechanicLethal, consumeEffectStacks } from "./helpers";
import { triggerEffectResolver } from "./effectResolvers";
import { cullResolved } from "./util";
import { TOWER_LINGER } from "@shared/constants";

export function resolveTowers(ctx: TickContext): {
  towers: ActiveTower[];
  pendingTowers: PendingTower[];
} {
  const { players, log, time } = ctx;
  const remainingPendingTowers: PendingTower[] = [];
  const towers: ActiveTower[] = ctx.world.towers.map(t => ({ ...t }));
  for (const pt of ctx.world.pendingTowers) {
    if (pt.t <= time) {
      towers.push({
        id: pt.id,
        name: pt.name,
        labels: pt.labels,
        group: pt.group,
        pos: pt.pos,
        radius: pt.radius,
        telegraphStart: pt.t,
        resolveAt: pt.t + pt.telegraph,
        requiredCount: pt.requiredCount,
        requiredRoles: pt.requiredRoles,
        wrongRoleLethal: pt.wrongRoleLethal,
        failureDamage: pt.failureDamage,
        failureDamageType: pt.failureDamageType,
        applyEffect: pt.applyEffect,
        consumeEffect: pt.consumeEffect,
        knockback: pt.knockback,
        resolveEventIds: pt.resolveEventIds,
        visual: pt.visual,
        resolved: false,
        soakerCount: 0,
      });
    } else {
      remainingPendingTowers.push(pt);
    }
  }

  for (const tower of towers) {
    if (!tower.resolved) {
      const towerShape: AOEShape = { kind: "circle", center: tower.pos, radius: tower.radius };
      const inside = players.filter(p => p.alive && pointInShape(towerShape, p.pos));
      const validSoakers = inside.filter(p => !tower.requiredRoles || tower.requiredRoles.includes(p.role));
      tower.soakerCount = validSoakers.length;

      if (tower.resolveAt <= time) {
        // Wrong-role soakers die when the tower opts into lethal punishment.
        if (tower.requiredRoles && tower.wrongRoleLethal) {
          for (const p of inside) {
            if (!tower.requiredRoles.includes(p.role) && !p.invincible) {
              applyMechanicLethal(p, time);
              log.push({ t: time, mechanic: tower.name, playerId: p.id, event: "hit" });
            }
          }
        }

        const resolvedDebuffPlayers: Player[] = [];
        for (const id of tower.resolveEventIds) {
          const resolver = ctx.world.effectResolvers[id];
          if (resolver) resolvedDebuffPlayers.push(...triggerEffectResolver(ctx, resolver, validSoakers));
        }

        const success = validSoakers.length >= tower.requiredCount;
        if (success) {
          // Hand the soakers whose charge a resolver consumed to the reassign system (runs later this
          // tick) so it can re-balance charges by this tower's label.
          if (resolvedDebuffPlayers.length > 0) {
            ctx.resolvedTowers.push({ labels: tower.labels ?? [], playerIds: resolvedDebuffPlayers.map(p => p.id) });
          }
          for (const p of validSoakers) {
            if (!p.alive) continue;
            if (tower.applyEffect) applyEffect(p, tower.applyEffect, time, `${tower.id}-${p.id}-eff`, players);
            if (tower.consumeEffect) consumeEffectStacks(p, tower.consumeEffect.effectName, tower.consumeEffect.stacks, time);
            if (tower.knockback && p.antiKbActive <= 0) {
              applyKnockback(p, tower.knockback, tower.knockback.origin ?? tower.pos, time);
            }
            log.push({ t: time, mechanic: tower.name, playerId: p.id, event: "cleared" });
          }
        } else {
          // Unsoaked: the whole raid eats the failure damage.
          for (const p of players) {
            if (!p.alive || p.invincible) continue;
            applyMechanicDamage(p, tower.failureDamage, tower.failureDamageType, time);
            log.push({ t: time, mechanic: tower.name, playerId: p.id, event: "hit" });
          }
        }
        tower.resolved = true;
        tower.outcome = success ? "success" : "failure";
      }
    }
  }

  // Keep briefly after resolve so the renderer can flash success/failure.
  return { towers: cullResolved(towers, time, TOWER_LINGER), pendingTowers: remainingPendingTowers };
}
