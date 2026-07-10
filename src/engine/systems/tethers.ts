// Phase 2: tether sources. Promote pending tethers, keep their attachment pointed at the nearest
// living player, allow interception before finalization, then finalize into a buff/debuff effect.

import type { TickContext } from "./context";
import type { AOEShape, TetherSource, PendingTether } from "@shared/types";
import { length, normalize, sub, type Vec2 } from "@shared/math";
import { pointInShape } from "../shapes";
import { selectTargetPlayer, findInterceptor, applyEffect, applyMechanicDamage } from "./helpers";
import { addResolvedAoeVisual } from "./effectResolvers";
import { clockwiseTetherOrder } from "../blackHoleOrbs";

const TETHER_LINGER = 2;

function fireTetherBeam(ctx: TickContext, ts: TetherSource, target: TickContext["players"][number] | undefined): void {
  const { players, log, time } = ctx;
  if (target && ts.applyEffect) {
    applyEffect(target, ts.applyEffect, time, `${ts.id}-effect`, players);
    log.push({ t: time, mechanic: ts.buffName, playerId: target.id, event: ts.tetherKind === "buff" ? "cleared" : "hit" });
  }
  if (!ts.beam) return;
  const aim = ts.beam.pointing ?? (target && sub(target.pos, ts.pos));
  if (!aim || length(aim) === 0) return;
  const shape: AOEShape = {
    kind: "rect",
    origin: ts.pos,
    direction: normalize(aim),
    width: ts.beam.width,
    length: ts.beam.length,
  };
  addResolvedAoeVisual(ctx, `${ts.id}-beam-${ts.nextFireIndex}`, ts.buffName, shape);
  for (const player of players) {
    if (!player.alive || !pointInShape(shape, player.pos)) continue;
    applyMechanicDamage(player, ts.beam.damage, ts.beam.damageType, time);
    log.push({ t: time, mechanic: ts.buffName, playerId: player.id, event: "hit" });
    if (player.alive && ts.beam.applyEffect) applyEffect(player, ts.beam.applyEffect, time, `${ts.id}-beam-${ts.nextFireIndex}-${player.id}`, players);
  }
}

export function resolveTethers(ctx: TickContext): {
  tetherSources: TetherSource[];
  pendingTethers: PendingTether[];
  blackHoleTetherOrder: Record<string, Vec2[]>;
} {
  const { players, log, time } = ctx;

  // Locked clockwise tether orders (per Black Hole hazard). Lazily lock the first time any of a
  // hazard's lasers promotes: sort its tether orbs clockwise from the orderFrom boss's position,
  // then hold that order for the hazard's lifetime so a later teleport can't reshuffle it.
  const blackHoleTetherOrder: Record<string, Vec2[]> = { ...ctx.world.blackHoleTetherOrder };
  const orbPos = (fromBlackHoleOrb: NonNullable<PendingTether["fromBlackHoleOrb"]>): Vec2 => {
    const { hazardId, order } = fromBlackHoleOrb;
    let ordered = blackHoleTetherOrder[hazardId];
    if (!ordered) {
      const spec = ctx.world.blackHoleTethers[hazardId];
      if (!spec) throw new Error(`tether references unknown black-hole hazard "${hazardId}"`);
      if (!spec.orderFrom) throw new Error(`black-hole hazard "${hazardId}" needs orderFrom to resolve tether order`);
      const from = ctx.bosses.find(b => b.id === spec.orderFrom)?.pos;
      if (!from) throw new Error(`black-hole hazard "${hazardId}" orders from missing boss "${spec.orderFrom}"`);
      ordered = clockwiseTetherOrder(spec.positions, from);
      blackHoleTetherOrder[hazardId] = ordered;
    }
    return ordered[order]!;
  };

  let tetherSources: TetherSource[] = ctx.world.tetherSources.map(ts => ({ ...ts }));
  const remainingPendingTethers: PendingTether[] = [];
  for (const pt of ctx.world.pendingTethers) {
    if (pt.t <= time) {
      const pos = pt.fromBlackHoleOrb ? orbPos(pt.fromBlackHoleOrb) : pt.pos!;
      const nearest = selectTargetPlayer(players, pos, "closest");
      tetherSources.push({
        id: pt.id,
        pos,
        spawnAt: pt.t,
        finalizeAt: pt.t + pt.finalizeAfter,
        fireTimes: (pt.fireOffsets ?? [pt.finalizeAfter]).map(offset => pt.t + offset),
        nextFireIndex: 0,
        expireAt: pt.despawnAfter === undefined ? undefined : pt.t + pt.despawnAfter,
        tetherKind: pt.tetherKind,
        buffName: pt.buffName,
        applyEffect: pt.applyEffect,
        showSource: pt.showSource,
        beam: pt.beam,
        tetheredPlayerId: nearest?.id ?? null,
        finalized: false,
      });
    } else {
      remainingPendingTethers.push(pt);
    }
  }

  for (const ts of tetherSources) {
    if (ts.finalized) continue;

    // Sticky targeting: keep the same target unless they die (or there's none yet). Persistent
    // tethers keep hitting the same locked target across all of their scheduled fires.
    if (!ts.tetheredPlayerId || !players.find(p => p.id === ts.tetheredPlayerId)?.alive) {
      ts.tetheredPlayerId = selectTargetPlayer(players, ts.pos, "closest")?.id ?? null;
    }

    // Check for interceptions before each upcoming scheduled fire (not just the first) - someone
    // can walk the source->target line to steal the tether ahead of any of its hits.
    if (ts.tetheredPlayerId && ts.nextFireIndex < ts.fireTimes.length && time < ts.fireTimes[ts.nextFireIndex]!) {
      const target = players.find(p => p.id === ts.tetheredPlayerId)!;
      const interceptor = findInterceptor(players, ts.pos, target.pos, ts.tetheredPlayerId);
      if (interceptor) ts.tetheredPlayerId = interceptor.id;
    }

    // Fire each scheduled laser once. Single-shot tethers finalize on their only fire; persistent
    // tethers stay interceptable until expireAt.
    while (ts.nextFireIndex < ts.fireTimes.length && time >= ts.fireTimes[ts.nextFireIndex]!) {
      const target = players.find(p => p.id === ts.tetheredPlayerId);
      fireTetherBeam(ctx, ts, target);
      ts.nextFireIndex++;
      if (ts.expireAt === undefined) ts.finalized = true;
    }
    if (ts.expireAt !== undefined && time >= ts.expireAt) ts.finalized = true;
  }

  // Cull sources finalized more than 2s ago
  tetherSources = tetherSources.filter(ts => !ts.finalized || ts.finalizeAt > time - TETHER_LINGER);
  return { tetherSources, pendingTethers: remainingPendingTethers, blackHoleTetherOrder };
}
