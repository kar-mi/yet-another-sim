// Phase 2a: line links. Visual object-to-player links with fixed targets and a hidden debuff held
// until resolve. Role-group targets can be chosen as the complement of a linked event (or randomly).

import type { TickContext } from "./context";
import type { ActiveLineLink, PendingLineLink } from "@shared/types";
import { selectLineLinkTargets, applyEffect, applyKnockback } from "./helpers";
import { cullResolved } from "./util";
import { LINE_LINK_LINGER } from "@shared/constants";

export function resolveLineLinks(ctx: TickContext): {
  lineLinks: ActiveLineLink[];
  pendingLineLinks: PendingLineLink[];
} {
  const { players, log, time, groupChoices, randInt } = ctx;
  const remainingPendingLineLinks: PendingLineLink[] = [];
  const lineLinks: ActiveLineLink[] = ctx.world.lineLinks.map(link => ({ ...link }));
  for (const pendingLink of ctx.world.pendingLineLinks) {
    if (pendingLink.t <= time) {
      let target = pendingLink.target;
      if (pendingLink.target.roleGroups) {
        const linkedIdx = pendingLink.link !== undefined ? groupChoices[pendingLink.link] : undefined;
        let chosenIdx = linkedIdx !== undefined ? 1 - linkedIdx : 0;
        if (linkedIdx === undefined && pendingLink.rng) {
          chosenIdx = randInt(pendingLink.target.roleGroups.length);
        }
        groupChoices[pendingLink.id] = chosenIdx;
        target = { ...pendingLink.target, roles: pendingLink.target.roleGroups[chosenIdx] };
      }
      const targets = selectLineLinkTargets(players, pendingLink.pos, target);
      const resolveAt = pendingLink.t + pendingLink.resolveAfter;
      for (const target of targets) {
        applyEffect(target, {
          name: pendingLink.hiddenDebuffName,
          kind: "debuff",
          duration: Math.max(0.01, resolveAt - time),
          behavior: { kind: "none" },
          visibility: "invisible",
        }, time, `${pendingLink.id}-${target.id}-hidden`, players);
      }
      lineLinks.push({
        id: pendingLink.id,
        name: pendingLink.name,
        pos: pendingLink.pos,
        spawnAt: pendingLink.t,
        linkUntil: pendingLink.t + pendingLink.linkDuration,
        resolveAt,
        target,
        targetPlayerIds: targets.map(target => target.id),
        hiddenDebuffName: pendingLink.hiddenDebuffName,
        applyEffect: pendingLink.applyEffect,
        knockback: pendingLink.knockback,
        visual: pendingLink.visual,
        resolved: false,
      });
    } else {
      remainingPendingLineLinks.push(pendingLink);
    }
  }

  for (const link of lineLinks) {
    if (!link.resolved && time >= link.resolveAt) {
      link.resolved = true;
      for (const targetId of link.targetPlayerIds) {
        const target = players.find(p => p.id === targetId);
        if (!target) continue;
        target.effects = target.effects.filter(e => e.id !== `${link.id}-${target.id}-hidden`);
        if (target.alive) {
          if (link.applyEffect) applyEffect(target, link.applyEffect, time, `${link.id}-${target.id}-eff`, players);
          if (link.knockback && target.antiKbActive <= 0) {
            applyKnockback(target, link.knockback, link.knockback.origin ?? link.pos, time);
          }
          log.push({ t: time, mechanic: link.name, playerId: target.id, event: "hit" });
        }
      }
    }
  }

  // Keep briefly after resolve so the renderer can flash the hit.
  return {
    lineLinks: cullResolved(lineLinks, time, LINE_LINK_LINGER),
    pendingLineLinks: remainingPendingLineLinks,
  };
}
