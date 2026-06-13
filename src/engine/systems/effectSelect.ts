// Effect-select events: At spawn time choose a group/member (random / complement of a
// linked event) and apply a visible effect to the chosen member.

import type { TickContext } from "./context";
import type { PendingEffectSelect } from "@shared/types";
import { applyEffect } from "./helpers";

export function resolveEffectSelects(ctx: TickContext): PendingEffectSelect[] {
  const { players, log, time, groupChoices, randInt } = ctx;
  const remaining: PendingEffectSelect[] = [];
  for (const pe of ctx.world.pendingEffectSelects) {
    if (pe.t <= time) {
      let chosenIdx: number;
      const linkedIdx = pe.link !== undefined ? groupChoices[pe.link] : undefined;
      if (linkedIdx !== undefined) {
        chosenIdx = 1 - linkedIdx;
      } else if (pe.rng) {
        chosenIdx = randInt(pe.groups.length);
      } else {
        chosenIdx = 0;
      }
      groupChoices[pe.id] = chosenIdx;

      const members = pe.groups[chosenIdx];
      const targetId = members[randInt(members.length)];
      const target = players.find(p => p.id === targetId && p.alive);
      if (target) {
        applyEffect(target, pe.applyEffect, time, `${pe.id}-${target.id}-eff`, players);
        log.push({ t: time, mechanic: pe.name, playerId: target.id, event: "hit" });
      }
    } else {
      remaining.push(pe);
    }
  }
  return remaining;
}
