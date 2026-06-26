// Apply-effect events: Drop a buff/debuff straight onto players (all / by role / by id /
// by count, optionally a random subset).

import type { TickContext } from "./context";
import type { EffectSpec, PendingApplyEffect } from "@shared/types";
import { applyEffect } from "./helpers";

function selectedEffect(pae: PendingApplyEffect, groupChoices: Record<string, number>, randInt: (n: number) => number): EffectSpec {
  if (!pae.applyEffectChoices) return pae.applyEffect!;
  const key = pae.effectChoiceGroup ?? pae.id;
  let idx = groupChoices[key];
  if (idx === undefined) {
    idx = pae.rng ? randInt(pae.applyEffectChoices.length) : 0;
    groupChoices[key] = idx;
  }
  if (pae.effectChoiceComplement) idx = 1 - idx;
  return pae.applyEffectChoices[idx]!;
}

export function resolveApplyEffects(ctx: TickContext): PendingApplyEffect[] {
  const { players, log, time, groupChoices, randInt } = ctx;
  const remaining: PendingApplyEffect[] = [];
  const assigned = new Map<string, Set<string>>();
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
    const assignedInGroup = pae.assignGroup
      ? assigned.get(pae.assignGroup) ?? new Set<string>()
      : undefined;
    if (pae.assignGroup && assignedInGroup && !assigned.has(pae.assignGroup)) {
      assigned.set(pae.assignGroup, assignedInGroup);
    }
    if (assignedInGroup) {
      pool = pool.filter(p => !assignedInGroup.has(p.id));
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
    if (assignedInGroup) {
      for (const target of pool) assignedInGroup.add(target.id);
    }
    const effect = selectedEffect(pae, groupChoices, randInt);
    for (const target of pool) {
      applyEffect(target, effect, time, `${pae.id}-${target.id}-eff`, players);
      log.push({ t: time, mechanic: pae.name, playerId: target.id, event: "hit" });
    }
  }
  return remaining;
}
