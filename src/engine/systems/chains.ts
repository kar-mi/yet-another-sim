// Phase 2b: chains. Promote pending pairs, bind the debuff at cast end, break on separation, burst
// on expiry. The chain entity is authoritative; the debuff is display-only.

import type { TickContext } from "./context";
import type { ActiveChain, PendingChain, EffectSpec } from "@shared/types";
import { length, sub } from "@shared/math";
import { applyEffect } from "./helpers";
import { CHAIN_LINGER } from "@shared/constants";

export function resolveChains(ctx: TickContext): {
  chains: ActiveChain[];
  pendingChains: PendingChain[];
} {
  const { players, log, time } = ctx;
  const remainingPendingChains: PendingChain[] = [];
  const chains: ActiveChain[] = ctx.world.chains.map(c => ({ ...c }));
  for (const pc of ctx.world.pendingChains) {
    if (pc.t <= time) {
      chains.push({
        id: pc.id,
        name: pc.name,
        a: pc.a,
        b: pc.b,
        telegraphStart: pc.t,
        resolveAt: pc.t + pc.telegraph,
        expireAt: pc.t + pc.telegraph + pc.breakWindow,
        breakDistance: pc.breakDistance,
        breakDamage: pc.breakDamage,
        damageType: pc.damageType,
        debuffName: pc.debuffName,
        showCastBar: pc.showCastBar,
        resolved: false,
        broken: false,
      });
    } else {
      remainingPendingChains.push(pc);
    }
  }

  const stillChains: ActiveChain[] = [];
  for (const chain of chains) {
    const a = players.find(p => p.id === chain.a);
    const b = players.find(p => p.id === chain.b);
    const aEffId = `${chain.id}-${chain.a}-eff`;
    const bEffId = `${chain.id}-${chain.b}-eff`;

    // Cast end: bind the debuff to both living members; the line now connects them.
    // The break threshold is the pair's starting separation plus the configured extra distance.
    if (!chain.resolved && time >= chain.resolveAt) {
      chain.resolved = true;
      const startDist = a && b ? length(sub(a.pos, b.pos)) : 0;
      chain.breakAt = startDist + chain.breakDistance;
      const spec: EffectSpec = {
        name: chain.debuffName,
        kind: "debuff",
        duration: chain.expireAt - chain.resolveAt,
        behavior: { kind: "none" },
      };
      if (a?.alive) applyEffect(a, spec, time, aEffId, players);
      if (b?.alive) applyEffect(b, spec, time, bEffId, players);
    }

    if (chain.resolved && chain.outcome === undefined) {
      if (a?.alive && b?.alive && length(sub(a.pos, b.pos)) > (chain.breakAt ?? chain.breakDistance)) {
        // Separated far enough in time: chain breaks, debuff falls off both, no damage.
        chain.broken = true;
        chain.outcome = "broken";
        chain.finishedAt = time;
        a.effects = a.effects.filter(e => e.id !== aEffId);
        b.effects = b.effects.filter(e => e.id !== bEffId);
        log.push({ t: time, mechanic: chain.name, playerId: chain.a, event: "cleared" });
        log.push({ t: time, mechanic: chain.name, playerId: chain.b, event: "cleared" });
      } else if (time >= chain.expireAt) {
        // Still chained when the window closes: both eat a single burst.
        chain.outcome = "damaged";
        chain.finishedAt = time;
        for (const member of [a, b]) {
          if (!member?.alive) continue;
          member.hp = Math.max(0, member.hp - chain.breakDamage);
          if (member.hp <= 0) member.alive = false;
          member.effects = member.effects.filter(e => e.id !== `${chain.id}-${member.id}-eff`);
          log.push({ t: time, mechanic: chain.name, playerId: member.id, event: "hit" });
        }
      }
    }

    // Keep briefly after the outcome so the renderer can flash the result.
    if (chain.outcome === undefined || (chain.finishedAt ?? time) >= time - CHAIN_LINGER) {
      stillChains.push(chain);
    }
  }
  return { chains: stillChains, pendingChains: remainingPendingChains };
}
