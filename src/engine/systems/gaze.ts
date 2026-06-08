// Phase 3g: gaze events. At cast start roll the reverse state (eye vs "?" eye). At resolve a player
// is hit if they are facing the eye (normal) or NOT facing it (reverse "?"). Facing is the player's
// last movement direction, so "looking away" means flicking the stick away then stopping.

import type { TickContext } from "./context";
import type { ActiveGaze, PendingGaze } from "../../shared/types";
import { applyMechanicDamage, applyEffect, applyKnockback, isLookingAt } from "./helpers";
import { cullResolved } from "./util";

export function resolveGazes(ctx: TickContext): {
  gazes: ActiveGaze[];
  pendingGazes: PendingGaze[];
} {
  const { players, log, time, dt, randFloat } = ctx;
  const remainingPendingGazes: PendingGaze[] = [];
  const gazes: ActiveGaze[] = ctx.world.gazes.map(g => ({ ...g }));
  for (const pg of ctx.world.pendingGazes) {
    if (pg.t <= time) {
      const reverse = pg.rng ? randFloat() < 0.5 : pg.reverse;
      gazes.push({
        id: pg.id,
        name: pg.name,
        pos: pg.pos,
        reverse,
        coneHalfAngle: pg.coneHalfAngle,
        telegraphStart: pg.t,
        resolveAt: pg.t + pg.telegraph,
        damage: pg.damage,
        damageType: pg.damageType,
        applyEffect: pg.applyEffect,
        knockback: pg.knockback,
        showCastBar: pg.showCastBar,
        visual: pg.visual,
        resolved: false,
      });
    } else {
      remainingPendingGazes.push(pg);
    }
  }

  for (const gz of gazes) {
    if (!gz.resolved && gz.resolveAt <= time) {
      for (const player of players) {
        if (!player.alive) continue;
        const looking = isLookingAt(player.facing, player.pos, gz.pos, gz.coneHalfAngle);
        const hit = gz.reverse ? !looking : looking;
        if (hit) {
          applyMechanicDamage(player, gz.damage, gz.damageType, time);
          log.push({ t: time, mechanic: gz.name, playerId: player.id, event: "hit" });
          if (gz.applyEffect && player.alive) {
            applyEffect(player, gz.applyEffect, time, `${gz.id}-${player.id}-eff`, players);
          }
          if (gz.knockback && player.alive && player.antiKbActive <= 0) {
            applyKnockback(player, gz.knockback, gz.knockback.origin ?? gz.pos, time);
          }
        } else {
          log.push({ t: time, mechanic: gz.name, playerId: player.id, event: "cleared" });
        }
      }
      gz.resolved = true;
    }
  }

  // Keep briefly after resolve so the renderer can flash the hit.
  return { gazes: cullResolved(gazes, time, dt), pendingGazes: remainingPendingGazes };
}
