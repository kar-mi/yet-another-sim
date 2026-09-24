import type { TickContext } from "./context";
import type { ActiveChain, PendingChain } from "@model/types";
import { length, sub } from "@shared/math";
import { applyStatus, overrideStatus, removeStatus } from "@status";
import { applyMechanicDamage } from "./helpers";
import { statusServices } from "./statusServices";
import { mechanicSource } from "./damageLog";
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
        debuff: pc.debuff,
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

    if (!chain.resolved && time >= chain.resolveAt) {
      chain.resolved = true;
      const startDist = a && b ? length(sub(a.pos, b.pos)) : 0;
      chain.breakAt = startDist + chain.breakDistance;
      const spec = overrideStatus(chain.debuff, { duration: chain.expireAt - chain.resolveAt });
      if (a?.alive) applyStatus(a, spec, aEffId, statusServices(ctx));
      if (b?.alive) applyStatus(b, spec, bEffId, statusServices(ctx));
    }

    if (chain.resolved && chain.outcome === undefined) {
      if (a?.alive && b?.alive && length(sub(a.pos, b.pos)) > (chain.breakAt ?? chain.breakDistance)) {
        chain.broken = true;
        chain.outcome = "broken";
        chain.finishedAt = time;
        removeStatus(a, aEffId);
        removeStatus(b, bEffId);
        log.push({ t: time, mechanic: chain.name, playerId: chain.a, event: "cleared" });
        log.push({ t: time, mechanic: chain.name, playerId: chain.b, event: "cleared" });
      } else if (time >= chain.expireAt) {
        chain.outcome = "damaged";
        chain.finishedAt = time;
        for (const member of [a, b]) {
          if (!member?.alive) continue;
          applyMechanicDamage(ctx, member, chain.breakDamage, chain.damageType, mechanicSource(ctx, chain.id, chain.name));
          removeStatus(member, `${chain.id}-${member.id}-eff`);
          log.push({ t: time, mechanic: chain.name, playerId: member.id, event: "hit" });
        }
      }
    }

    if (chain.outcome === undefined || (chain.finishedAt ?? time) >= time - CHAIN_LINGER) {
      stillChains.push(chain);
    }
  }
  return { chains: stillChains, pendingChains: remainingPendingChains };
}
