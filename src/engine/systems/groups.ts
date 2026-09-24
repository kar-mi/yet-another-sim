import type { TickContext } from "./context";
import { applyStatus } from "@status";
import { statusServices } from "./statusServices";
import type { ActiveGroupMechanic, PendingGroupEvent, AOEShape } from "@model/types";
import { mechanicSource } from "./damageLog";
import { resolveStackShare } from "./strikes";
import { cullResolved } from "./util";
import { TARGETED_LINGER } from "@shared/constants";
import { FloorAoe, DEFAULT_STACK_COLOR } from "@effects";

export function resolveGroups(ctx: TickContext): {
  groupMechanics: ActiveGroupMechanic[];
  pendingGroups: PendingGroupEvent[];
} {
  const { players, time, groupChoices, randInt } = ctx;
  const remainingPendingGroups: PendingGroupEvent[] = [];
  const groupMechanics: ActiveGroupMechanic[] = ctx.world.groupMechanics.map(g => ({ ...g }));
  for (const pg of ctx.world.pendingGroups) {
    if (pg.t <= time) {
      let chosenIdx: number;
      const linkedIdx = pg.link !== undefined ? groupChoices[pg.link] : undefined;
      if (linkedIdx !== undefined) {
        chosenIdx = 1 - linkedIdx;
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
        showMarker: pg.showMarker,
        showTelegraph: pg.showTelegraph,
        color: pg.color,
      });
    } else {
      remainingPendingGroups.push(pg);
    }
  }

  for (const gm of groupMechanics) {
    if (gm.resolved || !gm.showTelegraph) { gm.floorAoe = undefined; continue; }
    const marked = players.find(p => p.id === gm.markedPlayerId);
    gm.floorAoe = marked?.alive
      ? new FloorAoe({
        id: gm.id,
        shape: { kind: "circle", center: { x: marked.pos.x, z: marked.pos.z }, radius: gm.radius },
        color: gm.color ?? DEFAULT_STACK_COLOR,
        resolveMode: { kind: "active" },
        resolveAt: gm.resolveAt,
      })
      : undefined;
  }

  for (const gm of groupMechanics) {
    if (!gm.resolved && gm.resolveAt <= time) {
      const marked = players.find(p => p.id === gm.markedPlayerId);
      if (marked?.alive) {
        const circle: AOEShape = { kind: "circle", center: marked.pos, radius: gm.radius };
        const success = resolveStackShare(ctx, circle, gm, gm.damageType, mechanicSource(ctx, gm.id, gm.name), player => {
          if (gm.applyEffect && player.alive) {
            applyStatus(player, gm.applyEffect, `${gm.id}-${player.id}-eff`, statusServices(ctx));
          }
        });
        gm.outcome = success ? "success" : "failure";
      }
      gm.resolved = true;
    }
  }

  return {
    groupMechanics: cullResolved(groupMechanics, time, TARGETED_LINGER),
    pendingGroups: remainingPendingGroups,
  };
}
