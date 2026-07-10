// Phase 3g: gaze events. At cast start roll the reverse state (eye vs "?" eye). At resolve a player
// is hit if they are facing the eye (normal) or NOT facing it (reverse "?"). Facing is the player's
// last movement direction, so "looking away" means flicking the stick away then stopping.

import type { TickContext } from "./context";
import type { ActiveGaze, PendingGaze, AOEShape } from "@shared/types";
import { applyMechanicDamage, applyEffect, applyKnockback, isLookingAt } from "./helpers";
import { pointInShape } from "../shapes";
import { cullResolved } from "./util";
import { sin, cos } from "@shared/dmath";
import { FloorAoe, DEFAULT_GAZE_NORMAL_COLOR, DEFAULT_GAZE_REVERSE_COLOR } from "@shared/floorAoe";

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
      const carriers = pg.carriers
        ? players.filter(p => p.alive && p.effects.some(e => e.name === pg.carriers && e.appliedAt + e.duration > time))
        : [undefined];
      carriers.forEach((carrier, index) => {
        const id = carrier ? `${pg.id}-${carrier.id}` : pg.id;
        const direction = carrier && !reverse ? { x: sin(carrier.facing), z: cos(carrier.facing) } : undefined;
        const carrierCone = carrier && !reverse ? pg.carrierCone : undefined;
        const resolveAt = pg.t + pg.telegraph;
        const coneShape: AOEShape | undefined = direction && carrierCone
          ? { kind: "cone", origin: carrier!.pos, direction, ...carrierCone }
          : undefined;
        gazes.push({
          id,
          name: pg.name,
          pos: carrier ? { ...carrier.pos } : pg.pos,
          excludePlayerId: carrier?.id,
          carrierId: carrier?.id,
          direction,
          carrierCone,
          reverse,
          coneHalfAngle: pg.coneHalfAngle,
          telegraphStart: pg.t,
          resolveAt,
          damage: pg.damage,
          damageType: pg.damageType,
          applyEffect: pg.applyEffect,
          knockback: pg.knockback,
          showCastBar: pg.showCastBar && index === 0,
          visual: pg.visual,
          resolved: false,
          floorAoe: coneShape
            ? new FloorAoe({
              id, shape: coneShape,
              color: pg.color ?? (reverse ? DEFAULT_GAZE_REVERSE_COLOR : DEFAULT_GAZE_NORMAL_COLOR),
              alpha: 0.45,
              resolveMode: { kind: "active" },
              resolveAt,
            })
            : undefined,
        });
      });
    } else {
      remainingPendingGazes.push(pg);
    }
  }

  for (const gz of gazes) {
    if (!gz.resolved && gz.resolveAt <= time) {
      for (const player of players) {
        if (!player.alive || player.id === gz.excludePlayerId) continue;
        const looking = isLookingAt(player.facing, player.pos, gz.pos, gz.coneHalfAngle);
        const hit = gz.direction && gz.carrierCone
          ? pointInShape({ kind: "cone", origin: gz.pos, direction: gz.direction, ...gz.carrierCone }, player.pos)
          : gz.reverse ? !looking : looking;
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
