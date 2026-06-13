// Inverse ("?") events. At cast start roll the inversion (and optional B variant). The
// shown shape is always drawn as the telegraph, but when inverted the "?" makes it a lie -> the
// hidden shape is the lethal one.

import type { TickContext } from "./context";
import type { ActiveInverse, PendingInverse } from "@shared/types";
import { pointInShape } from "../shapes";
import { applyMechanicDamage, applyEffect, applyKnockback, shapeOrigin } from "./helpers";
import { cullResolved } from "./util";

export function resolveInversions(ctx: TickContext): {
  inversions: ActiveInverse[];
  pendingInversions: PendingInverse[];
} {
  const { players, log, time, dt, randFloat } = ctx;
  const remainingPendingInversions: PendingInverse[] = [];
  const inversions: ActiveInverse[] = ctx.world.inversions.map(i => ({ ...i }));
  for (const pi of ctx.world.pendingInversions) {
    if (pi.t <= time) {
      const variantB = (pi.variantRng && pi.shownShapesB && pi.hiddenShapesB) ? randFloat() < 0.5 : false;
      const shownShapes = variantB ? pi.shownShapesB! : pi.shownShapes;
      const hiddenShapes = variantB ? pi.hiddenShapesB! : pi.hiddenShapes;
      const inverted = pi.questionMark ?? (pi.rng ? randFloat() < 0.5 : false);
      inversions.push({
        id: pi.id,
        name: pi.name,
        shownShapes,
        hiddenShapes,
        ringColor: pi.ringColor,
        ringHeight: pi.ringHeight,
        telegraphAlpha: pi.telegraphAlpha,
        inverted,
        variantB,
        telegraphStart: pi.t,
        resolveAt: pi.t + pi.telegraph,
        damage: pi.damage,
        damageType: pi.damageType,
        applyEffect: pi.applyEffect,
        knockback: pi.knockback,
        showCastBar: pi.showCastBar,
        resolved: false,
      });
    } else {
      remainingPendingInversions.push(pi);
    }
  }

  for (const inv of inversions) {
    if (!inv.resolved && inv.resolveAt <= time) {
      const lethal = inv.inverted ? inv.hiddenShapes : inv.shownShapes;
      for (const player of players) {
        if (!player.alive) continue;
        const hitShape = lethal.find(shape => pointInShape(shape, player.pos));
        if (hitShape) {
          applyMechanicDamage(player, inv.damage, inv.damageType, time);
          log.push({ t: time, mechanic: inv.name, playerId: player.id, event: "hit" });
          if (inv.applyEffect && player.alive) {
            applyEffect(player, inv.applyEffect, time, `${inv.id}-${player.id}-eff`, players);
          }
          if (inv.knockback && player.alive && player.antiKbActive <= 0) {
            applyKnockback(player, inv.knockback, inv.knockback.origin ?? shapeOrigin(hitShape), time);
          }
        } else {
          log.push({ t: time, mechanic: inv.name, playerId: player.id, event: "cleared" });
        }
      }
      inv.resolved = true;
    }
  }

  // Keep briefly after resolve so the renderer can flash the hit.
  return {
    inversions: cullResolved(inversions, time, dt),
    pendingInversions: remainingPendingInversions,
  };
}
