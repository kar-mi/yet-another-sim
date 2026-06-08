// Phase 3: the core AOE pipeline. Promotes plain pending events (boss snapshots facing-anchored
// shapes), targeted baits, and effect-burst circles into one active list, then resolves every
// mechanic past its resolveAt with FFXIV snapshot semantics (damage, effects, knockback).

import type { TickContext } from "./context";
import type {
  ActiveMechanic, PendingEvent, PendingTargetedEvent, PendingEffectBurst,
} from "../../shared/types";
import { pointInShape } from "../shapes";
import { promotePending } from "../timeline";
import { TARGETED_LINGER } from "../constants";
import {
  selectTargetPlayer, inPositionalArc, applyMechanicDamage, applyEffect,
  effectsForMechanic, balancedEffectOrders, applyKnockback, shapeOrigin, isEffectActiveAt,
} from "./helpers";

export function resolveAoe(ctx: TickContext): {
  active: ActiveMechanic[];
  pending: PendingEvent[];
  pendingTargeted: PendingTargetedEvent[];
  pendingEffectBursts: PendingEffectBurst[];
} {
  const { players, boss, log, time, dt, randInt } = ctx;

  // 3. Promote pending events whose t <= time (boss snapshots facing-anchored shapes)
  const { promoted, remaining: pending } = promotePending(ctx.world.pending, time, boss);
  const active: ActiveMechanic[] = [...ctx.world.active.map(m => ({ ...m })), ...promoted];

  // 3b. Promote targeted events into casts. The near/far target (and circle center) is
  // chosen when the cast resolves, not now, so players can reposition during the telegraph.
  const remainingPendingTargeted: PendingTargetedEvent[] = [];
  for (const pt of ctx.world.pendingTargeted) {
    if (pt.t <= time) {
      active.push({
        id: pt.id,
        name: pt.name,
        shape: { kind: "circle", center: { x: 0, z: 0 }, radius: pt.radius },
        telegraphStart: pt.t,
        resolveAt: pt.t + pt.telegraph,
        damage: pt.damage,
        damageType: pt.damageType,
        applyEffect: pt.applyEffect,
        resolved: false,
        showCastBar: pt.showCastBar,
        showTelegraph: pt.showTelegraph,
        targeting: { mode: pt.targetMode, role: pt.role, origin: { x: 0, z: 0 } },
      });
    } else {
      remainingPendingTargeted.push(pt);
    }
  }

  // 3c. Promote effect-burst events: at cast start, drop an AOE circle on every player carrying the
  // named effect (e.g. a burst around each sleeping player). They then resolve like normal AOEs.
  const remainingPendingEffectBursts: PendingEffectBurst[] = [];
  for (const pb of ctx.world.pendingEffectBursts) {
    if (pb.t <= time) {
      const carriers = players.filter(p => p.alive && p.effects.some(e => e.name === pb.effectName && isEffectActiveAt(e, time)));
      carriers.forEach((carrier, i) => {
        active.push({
          id: `${pb.id}-${carrier.id}`,
          name: pb.name,
          shape: { kind: "circle", center: { x: carrier.pos.x, z: carrier.pos.z }, radius: pb.radius },
          telegraphStart: pb.t,
          resolveAt: pb.t + pb.telegraph,
          damage: pb.damage,
          damageType: pb.damageType,
          applyEffect: pb.applyEffect,
          knockback: pb.knockback,
          resolved: false,
          showCastBar: pb.showCastBar && i === 0, // one cast bar for the whole set
          showTelegraph: pb.showTelegraph,
        });
      });
    } else {
      remainingPendingEffectBursts.push(pb);
    }
  }

  // 3. Resolve mechanics past resolveAt (FFXIV snapshot semantics)
  const stillActive: ActiveMechanic[] = [];
  for (const mechanic of active) {
    if (!mechanic.resolved && mechanic.resolveAt <= time) {
      if (mechanic.targeting && mechanic.shape.kind === "circle") {
        const target = mechanic.targeting.mode === "aggro"
          ? players.find(p => p.alive && p.id === boss.currentTarget) ?? null
          : selectTargetPlayer(players, mechanic.targeting.origin, mechanic.targeting.mode, mechanic.targeting.role);
        if (!target) { mechanic.resolved = true; continue; } // no valid target: fizzle, no telegraph flash
        mechanic.shape = { kind: "circle", center: { x: target.pos.x, z: target.pos.z }, radius: mechanic.shape.radius };
      }
      const balancedOrders = mechanic.applyEffects?.order === "shuffleBalanced"
        ? balancedEffectOrders(
          mechanic.applyEffects.effects,
          players.filter(player =>
            player.alive
            && (!mechanic.positional || inPositionalArc(boss, player.pos, mechanic.positional))
            && pointInShape(mechanic.shape, player.pos)).length,
          randInt,
        )
        : [];
      let balancedOrderIndex = 0;
      for (const player of players) {
        if (!player.alive) continue;
        const inArc = !mechanic.positional || inPositionalArc(boss, player.pos, mechanic.positional);
        if (pointInShape(mechanic.shape, player.pos) && inArc) {
          applyMechanicDamage(player, mechanic.damage, mechanic.damageType, time);
          log.push({ t: time, mechanic: mechanic.name, playerId: player.id, event: "hit" });
          const effectSpecs = player.alive
            ? (mechanic.applyEffects?.order === "shuffleBalanced"
              ? (balancedOrders[balancedOrderIndex++] ?? mechanic.applyEffects.effects)
              : effectsForMechanic(mechanic, randInt))
            : [];
          for (const [effectIndex, effectSpec] of effectSpecs.entries()) {
            // For a plant debuff, stamp this player's assigned heading from the combination plan.
            // The slot can be remapped so timer/application order stays separate from combo order.
            let spec = effectSpec;
            let plantSlot: number | undefined;
            if (spec.behavior.kind === "plant") {
              const plantIndex = player.effects.filter(e => e.behavior.kind === "plant").length;
              plantSlot = ctx.world.plantDebuffOrder?.[plantIndex] ?? plantIndex;
              const dir = ctx.world.plantPlan[player.id]?.[plantSlot];
              if (dir) spec = { ...spec, behavior: { ...spec.behavior, direction: dir } };
            }
            const effectId = effectSpecs.length === 1
              ? `${mechanic.id}-${player.id}-eff`
              : `${mechanic.id}-${player.id}-eff-${effectIndex}`;
            applyEffect(player, spec, time, effectId, players, plantSlot);
          }
          if (mechanic.knockback && player.alive && player.antiKbActive <= 0) {
            const origin = mechanic.knockback.origin ?? shapeOrigin(mechanic.shape);
            applyKnockback(player, mechanic.knockback, origin, time);
          }
        } else {
          log.push({ t: time, mechanic: mechanic.name, playerId: player.id, event: "cleared" });
        }
      }
      mechanic.resolved = true;
    }
    // Keep briefly after resolve so the renderer can flash the hit; targeted baits linger
    // longer so the circle stays visible where it landed (damage already applied at resolveAt).
    const keepFor = mechanic.targeting ? TARGETED_LINGER : dt;
    if (!mechanic.resolved || mechanic.resolveAt >= time - keepFor) {
      stillActive.push(mechanic);
    }
  }

  return {
    active: stillActive,
    pending,
    pendingTargeted: remainingPendingTargeted,
    pendingEffectBursts: remainingPendingEffectBursts,
  };
}
