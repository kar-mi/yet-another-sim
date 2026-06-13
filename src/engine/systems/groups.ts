// Phase 3d: group events. At cast start pick a group (random / complement of a linked event) and a
// random member to mark; at resolve split the unavoidable damage across whoever stacks in.

import type { TickContext } from "./context";
import type { ActiveGroupMechanic, PendingGroupEvent, AOEShape } from "@shared/types";
import { pointInShape } from "../shapes";
import { applyMechanicDamage, applyEffect } from "./helpers";
import { cullResolved } from "./util";
import { TARGETED_LINGER } from "@shared/constants";

export function resolveGroups(ctx: TickContext): {
  groupMechanics: ActiveGroupMechanic[];
  pendingGroups: PendingGroupEvent[];
} {
  const { players, log, time, groupChoices, randInt } = ctx;
  const remainingPendingGroups: PendingGroupEvent[] = [];
  const groupMechanics: ActiveGroupMechanic[] = ctx.world.groupMechanics.map(g => ({ ...g }));
  for (const pg of ctx.world.pendingGroups) {
    if (pg.t <= time) {
      let chosenIdx: number;
      const linkedIdx = pg.link !== undefined ? groupChoices[pg.link] : undefined;
      if (linkedIdx !== undefined) {
        chosenIdx = 1 - linkedIdx; // 2-group complement (validated by the schema)
      } else if (pg.rng) {
        chosenIdx = randInt(pg.groups.length);
      } else {
        chosenIdx = 0;
      }
      groupChoices[pg.id] = chosenIdx;

      const members = pg.groups[chosenIdx];
      const marked = members[randInt(members.length)];

      groupMechanics.push({
        id: pg.id,
        name: pg.name,
        telegraphStart: pg.t,
        resolveAt: pg.t + pg.telegraph,
        markedPlayerId: marked,
        radius: pg.radius,
        requiredCount: pg.requiredCount,
        damage: pg.damage,
        damageType: pg.damageType,
        applyEffect: pg.applyEffect,
        resolved: false,
        showCastBar: pg.showCastBar,
      });
    } else {
      remainingPendingGroups.push(pg);
    }
  }

  for (const gm of groupMechanics) {
    if (!gm.resolved && gm.resolveAt <= time) {
      // Shared stack: a circle around the marked player. Soakers inside split the damage; if
      // fewer than requiredCount stack, it fails and each soaker eats the full (unsplit) hit.
      const marked = players.find(p => p.id === gm.markedPlayerId);
      if (marked?.alive) {
        const circle: AOEShape = { kind: "circle", center: marked.pos, radius: gm.radius };
        const soakers = players.filter(p => p.alive && pointInShape(circle, p.pos));
        const success = soakers.length >= gm.requiredCount;
        const per = success ? gm.damage / soakers.length : gm.damage;
        for (const player of soakers) {
          applyMechanicDamage(player, per, gm.damageType, time);
          log.push({ t: time, mechanic: gm.name, playerId: player.id, event: "hit" });
          if (gm.applyEffect && player.alive) {
            applyEffect(player, gm.applyEffect, time, `${gm.id}-${player.id}-eff`, players);
          }
        }
        gm.outcome = success ? "success" : "failure";
      }
      gm.resolved = true;
    }
  }

  // Keep briefly after resolve so the renderer can flash the hit.
  return {
    groupMechanics: cullResolved(groupMechanics, time, TARGETED_LINGER),
    pendingGroups: remainingPendingGroups,
  };
}
