// AOE pipeline: Promotes plain pending events (boss snapshots facing-anchored
// shapes), targeted baits, and effect-burst circles into one active list, then resolves every
// mechanic past its resolveAt with FFXIV snapshot semantics (damage, effects, knockback).

import type { TickContext } from "./context";
import type {
  ActiveMechanic, PendingEvent, PendingTargetedEvent, PendingBaitEvent, PendingEffectBurst,
  Player, Role, Boss,
} from "../../shared/types";
import { pointInShape } from "../shapes";
import { promotePending, anchorShape } from "../timeline";
import { AOE_RESOLVE_LINGER, TARGETED_LINGER } from "../constants";
import {
  selectTargetPlayer, inPositionalArc, applyMechanicDamage, applyEffect,
  effectsForMechanic, balancedEffectOrders, applyKnockback, shapeOrigin, isEffectActiveAt,
} from "./helpers";

// Pick the player a bait targets at cast start: "random" draws a seeded alive (optionally
// role-filtered) player; "closest"/"furthest" measure from the boss.
function selectBaitTarget(
  players: Player[],
  boss: Boss,
  mode: "random" | "closest" | "furthest",
  role: Role | undefined,
  randInt: (n: number) => number,
): Player | null {
  if (mode === "random") {
    const pool = players.filter(p => p.alive && (!role || p.role === role));
    return pool.length > 0 ? pool[randInt(pool.length)] : null;
  }
  return selectTargetPlayer(players, { x: boss.pos.x, z: boss.pos.z }, mode, role);
}

function baitDirectionOffset(target: Player, directionOffsetByEffect: Record<string, number> | undefined, time: number): number | undefined {
  if (!directionOffsetByEffect) return undefined;
  for (const effect of target.effects) {
    if (isEffectActiveAt(effect, time) && directionOffsetByEffect[effect.name] !== undefined) {
      return directionOffsetByEffect[effect.name];
    }
  }
  return undefined;
}

export function resolveAoe(ctx: TickContext): {
  active: ActiveMechanic[];
  pending: PendingEvent[];
  pendingTargeted: PendingTargetedEvent[];
  pendingBaits: PendingBaitEvent[];
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
        labels: pt.labels,
        group: pt.group,
        shape: { kind: "circle", center: { x: 0, z: 0 }, radius: pt.radius },
        telegraphStart: pt.t,
        resolveAt: pt.t + pt.telegraph,
        damage: pt.damage,
        damageType: pt.damageType,
        applyEffect: pt.applyEffect,
        resolved: false,
        showCastBar: pt.showCastBar,
        showTelegraph: pt.showTelegraph,
        telegraphMode: pt.telegraphMode,
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
          telegraphMode: pb.telegraphMode,
        });
      });
    } else {
      remainingPendingEffectBursts.push(pb);
    }
  }

  // 3d. Promote baits: at cast START pick a player (random/closest/furthest), turn the boss to face
  // them and lock facing, and drop a boss-front cone aimed at them. If the bait links a deferred
  // stored cleave, arm it now so it detonates in the same tick using this locked facing.
  const remainingPendingBaits: PendingBaitEvent[] = [];
  for (const pb of ctx.world.pendingBaits) {
    if (pb.t > time) { remainingPendingBaits.push(pb); continue; }
    const target = selectBaitTarget(players, boss, pb.targetMode, pb.role, randInt);
    if (!target) continue; // no valid target: fizzle (the linked stored cleave stays dormant)
    boss.facing = Math.atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z);
    // The bait deals no damage of its own: it is a turn + lock + cast-bar "controller". A zero-radius,
    // zero-damage mechanic holds the boss facing and drives the cast bar without its own telegraph.
    active.push({
      id: pb.id,
      name: pb.name,
      labels: pb.labels,
      group: pb.group,
      shape: { kind: "circle", center: { x: boss.pos.x, z: boss.pos.z }, radius: 0 },
      telegraphStart: pb.t,
      resolveAt: pb.t + pb.telegraph,
      damage: 0,
      damageType: "true",
      lockFacing: true,
      resolved: false,
      showCastBar: pb.showCastBar,
      showTelegraph: false,
    });
    // Arm the linked stored cleave (already dormant in `active` from its own earlier cast): recompute
    // its geometry from the now-locked facing + its stored directionOffset, and share this resolveAt so
    // the single cleave cone detonates at the bait's cast end.
    const stored = active.find(m => m.id === pb.link && m.deferred);
    if (stored) {
      const directionOffset = baitDirectionOffset(target, pb.directionOffsetByEffect, time) ?? stored.directionOffset;
      stored.shape = anchorShape(boss, stored.shape, {
        anchor: stored.anchor,
        directionFrom: stored.directionFrom,
        directionOffset,
      });
      stored.telegraphStart = pb.t;
      stored.resolveAt = pb.t + pb.telegraph;
      stored.armed = true;
      stored.showTelegraph = true;
      stored.showCastBar = false;
    }
  }

  // 3. Resolve mechanics past resolveAt (FFXIV snapshot semantics)
  const stillActive: ActiveMechanic[] = [];
  for (const mechanic of active) {
    if (!mechanic.resolved && mechanic.resolveAt <= time) {
      // A deferred stored cleave whose own cast bar has finished but no bait has armed it yet: go
      // dormant (hidden, unresolved) and wait for a linked bait to arm + detonate it.
      if (mechanic.deferred && !mechanic.armed) {
        mechanic.showCastBar = false;
        mechanic.showTelegraph = false;
        stillActive.push(mechanic);
        continue;
      }
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
    const keepFor = mechanic.lingerFor
      ?? (mechanic.targeting ? TARGETED_LINGER : mechanic.telegraphMode === "resolve" ? AOE_RESOLVE_LINGER : dt);
    if (!mechanic.resolved || mechanic.resolveAt >= time - keepFor) {
      stillActive.push(mechanic);
    }
  }

  return {
    active: stillActive,
    pending,
    pendingTargeted: remainingPendingTargeted,
    pendingBaits: remainingPendingBaits,
    pendingEffectBursts: remainingPendingEffectBursts,
  };
}
