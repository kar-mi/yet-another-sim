// AOE pipeline: Promotes plain pending events (boss snapshots facing-anchored
// shapes), targeted baits, and effect-burst circles into one active list, then resolves every
// mechanic past its resolveAt with FFXIV snapshot semantics (damage, effects, knockback).

import type { TickContext } from "./context";
import type {
  ActiveMechanic, PendingEvent, PendingTargetedEvent, PendingBaitEvent, PendingDashEvent, PendingEffectBurst,
  Player, Role, Boss, AOEShape, DashDestination,
} from "@shared/types";
import type { Vec2 } from "@shared/math";

function bossFor(bosses: Boss[], bossId?: string): Boss {
  const b = bossId ? bosses.find(b => b.id === bossId) : undefined;
  return b ?? bosses[0]!;
}
import { pointInShape } from "../shapes";
import { promotePending, anchorShape } from "../timeline";
import { AOE_RESOLVE_LINGER, TARGETED_LINGER } from "@shared/constants";
import { FloorAoe, DEFAULT_DANGER_COLOR } from "@shared/floorAoe";
import { buildFloorAoe } from "../floorAoeBuild";
import { atan2 } from "@shared/dmath";
import {
  selectTargetPlayer, selectTargetPlayers, inPositionalArc, applyMechanicDamage, applyEffect,
  effectsForMechanic, balancedEffectOrders, applyKnockback, shapeOrigin, isEffectActiveAt,
} from "./helpers";
import { addResolvedAoeVisual } from "./effectResolvers";

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

function selectDashDestination(
  players: Player[],
  boss: Boss,
  destination: DashDestination,
  time: number,
  randomTargetId?: string,
): Vec2 {
  if ("to" in destination) return { ...destination.to };
  if ("debuff" in destination) {
    const carriers = players.filter(player => player.alive
      && player.effects.some(effect => effect.name === destination.debuff && isEffectActiveAt(effect, time)));
    const carrier = selectTargetPlayer(carriers, boss.pos, "closest");
    return carrier ? { ...carrier.pos } : { ...boss.pos };
  }
  if (destination.bait === "random") {
    const target = players.find(player => player.id === randomTargetId && player.alive);
    return target ? { ...target.pos } : { ...boss.pos };
  }
  if (destination.bait === "aggro") {
    const target = players.find(player => player.id === boss.currentTarget && player.alive
      && (!destination.role || player.role === destination.role));
    return target ? { ...target.pos } : { ...boss.pos };
  }
  const target = selectTargetPlayer(players, boss.pos, destination.bait, destination.role);
  return target ? { ...target.pos } : { ...boss.pos };
}

export function resolveAoe(ctx: TickContext): {
  active: ActiveMechanic[];
  pending: PendingEvent[];
  pendingTargeted: PendingTargetedEvent[];
  pendingBaits: PendingBaitEvent[];
  pendingDashes: PendingDashEvent[];
  pendingEffectBursts: PendingEffectBurst[];
} {
  const { players, bosses, boss, log, time, dt, randInt } = ctx;

  // 3. Promote pending events whose t <= time (boss snapshots facing-anchored shapes)
  const { promoted, remaining: pending } = promotePending(ctx.world.pending, time, bosses, players);
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
        bossId: pt.bossId,
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
        color: pt.color,
        // The center isn't chosen until resolve, so no floorAoe yet (see the targeting-resolution
        // branch below, which builds one once the shape is finalized).
        targeting: { mode: pt.targetMode, role: pt.role, origin: { x: 0, z: 0 }, count: pt.count },
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
      const inverted = pb.questionMark ?? (pb.rng ? ctx.randFloat() < 0.5 : false);
      const shape = inverted ? pb.hiddenShape : pb.shownShape;
      carriers.forEach((carrier, i) => {
        const id = `${pb.id}-${carrier.id}`;
        const burstShape: AOEShape = shape === "donut"
          ? { kind: "donut", center: { x: carrier.pos.x, z: carrier.pos.z }, inner: pb.innerRadius!, outer: pb.radius }
          : { kind: "circle", center: { x: carrier.pos.x, z: carrier.pos.z }, radius: pb.radius };
        const resolveAt = pb.t + pb.telegraph;
        active.push({
          id,
          name: pb.name,
          shape: burstShape,
          telegraphStart: pb.t,
          resolveAt,
          damage: pb.damage,
          damageType: pb.damageType,
          applyEffect: pb.applyEffect,
          knockback: pb.knockback,
          resolved: false,
          showCastBar: pb.showCastBar && i === 0, // one cast bar for the whole set
          showTelegraph: pb.showTelegraph,
          telegraphMode: pb.telegraphMode,
          color: pb.color,
          floorAoe: buildFloorAoe({
            id, shape: burstShape, color: pb.color, showTelegraph: pb.showTelegraph,
            telegraphMode: pb.telegraphMode, resolveAt,
          }),
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
    const baitBoss = bossFor(bosses, pb.bossId);
    const target = selectBaitTarget(players, baitBoss, pb.targetMode, pb.role, randInt);
    if (!target) continue; // no valid target: fizzle (the linked stored cleave stays dormant)
    baitBoss.facing = atan2(target.pos.x - baitBoss.pos.x, target.pos.z - baitBoss.pos.z);
    // The bait deals no damage of its own: it is a turn + lock + cast-bar "controller". A zero-radius,
    // zero-damage mechanic holds the boss facing and drives the cast bar without its own telegraph.
    active.push({
      id: pb.id,
      name: pb.name,
      labels: pb.labels,
      group: pb.group,
      bossId: pb.bossId,
      shape: { kind: "circle", center: { x: baitBoss.pos.x, z: baitBoss.pos.z }, radius: 0 },
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
      stored.shape = anchorShape(baitBoss, stored.shape, {
        anchor: stored.anchor,
        directionFrom: stored.directionFrom,
        directionOffset,
      });
      stored.telegraphStart = pb.t;
      stored.resolveAt = pb.t + pb.telegraph;
      stored.armed = true;
      stored.showTelegraph = true;
      stored.showCastBar = false;
      stored.floorAoe = buildFloorAoe({
        id: stored.id, shape: stored.shape, color: stored.color, showTelegraph: true,
        telegraphMode: stored.telegraphMode, flashBeforeResolve: stored.flashBeforeResolve,
        resolveAt: stored.resolveAt,
      });
    }
  }

  // 3e. Dashes remain pending through their windup so the landing marker can track a live target.
  // At cast end the boss blinks, then the linked stored AOE is re-anchored and given a fresh cast.
  const remainingPendingDashes: PendingDashEvent[] = [];
  for (const pd of ctx.world.pendingDashes) {
    if (pd.t > time) { remainingPendingDashes.push(pd); continue; }
    const dashBoss = bossFor(bosses, pd.bossId);
    const resolveAt = pd.t + pd.telegraph;
    let randomTargetId = pd.randomTargetId;
    const started = active.some(mechanic => mechanic.id === pd.id && !mechanic.resolved);

    if (!started) {
      if ("bait" in pd.destination && pd.destination.bait === "random") {
        randomTargetId = selectBaitTarget(players, dashBoss, "random", pd.destination.role, randInt)?.id;
      }
      const initialDestination = selectDashDestination(players, dashBoss, pd.destination, time, randomTargetId);
      // Visual-only cast controller and landing marker. Like bait's controller, these use the normal
      // zero-damage ActiveMechanic path, including its resolve-time combat-log entries.
      active.push({
        id: pd.id,
        name: pd.name,
        labels: pd.labels,
        group: pd.group,
        bossId: pd.bossId,
        shape: { kind: "circle", center: { ...dashBoss.pos }, radius: 0 },
        telegraphStart: pd.t,
        resolveAt,
        damage: 0,
        damageType: "true",
        lockFacing: true,
        bossStationary: true,
        resolved: false,
        showCastBar: pd.showCastBar,
        showTelegraph: false,
      });
      const landingId = `${pd.id}-landing`;
      const landingShape: AOEShape = { kind: "circle", center: initialDestination, radius: dashBoss.radius };
      active.push({
        id: landingId,
        name: pd.name,
        bossId: pd.bossId,
        shape: landingShape,
        telegraphStart: pd.t,
        resolveAt,
        damage: 0,
        damageType: "true",
        resolved: false,
        showCastBar: false,
        showTelegraph: true,
        floorAoe: buildFloorAoe({ id: landingId, shape: landingShape, showTelegraph: true, resolveAt }),
      });
    }

    const destination = selectDashDestination(players, dashBoss, pd.destination, time, randomTargetId);
    const marker = active.find(mechanic => mechanic.id === `${pd.id}-landing` && !mechanic.resolved);
    if (marker) {
      marker.shape = { kind: "circle", center: destination, radius: dashBoss.radius };
      marker.floorAoe = buildFloorAoe({
        id: marker.id, shape: marker.shape, color: marker.color, showTelegraph: marker.showTelegraph,
        telegraphMode: marker.telegraphMode, flashBeforeResolve: marker.flashBeforeResolve, resolveAt: marker.resolveAt,
      });
    }

    if (resolveAt > time) {
      remainingPendingDashes.push({ ...pd, randomTargetId });
      continue;
    }

    const dx = destination.x - dashBoss.pos.x;
    const dz = destination.z - dashBoss.pos.z;
    if (dx !== 0 || dz !== 0) dashBoss.facing = atan2(dx, dz);
    dashBoss.pos = { ...destination };

    const stored = active.find(mechanic => mechanic.id === pd.link && mechanic.deferred);
    if (stored) {
      stored.shape = anchorShape(dashBoss, stored.shape, stored);
      stored.telegraphStart = time;
      stored.resolveAt = time + (stored.telegraphDuration ?? 0);
      stored.armed = true;
      stored.showTelegraph = true;
      stored.showCastBar = false;
      stored.floorAoe = buildFloorAoe({
        id: stored.id, shape: stored.shape, color: stored.color, showTelegraph: true,
        telegraphMode: stored.telegraphMode, flashBeforeResolve: stored.flashBeforeResolve,
        resolveAt: stored.resolveAt,
      });
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
      // N-closest spread: drop a damage circle on each of the N nearest/furthest players (a player
      // caught by several circles is hit once per circle). Resolves instantly with a flash per spot.
      if (mechanic.targeting && mechanic.shape.kind === "circle" && mechanic.targeting.mode !== "aggro"
        && (mechanic.targeting.count ?? 1) > 1) {
        const radius = mechanic.shape.radius;
        const mBoss = bossFor(bosses, mechanic.bossId);
        const targets = selectTargetPlayers(players, mBoss.pos, mechanic.targeting.mode, mechanic.targeting.count!, mechanic.targeting.role);
        for (const target of targets) {
          const circle: AOEShape = { kind: "circle", center: { x: target.pos.x, z: target.pos.z }, radius };
          addResolvedAoeVisual(ctx, `${mechanic.id}-${target.id}-visual`, mechanic.name, circle);
          for (const player of players) {
            if (!player.alive || !pointInShape(circle, player.pos)) continue;
            applyMechanicDamage(player, mechanic.damage, mechanic.damageType, time);
            log.push({ t: time, mechanic: mechanic.name, playerId: player.id, event: "hit" });
            if (mechanic.applyEffect) applyEffect(player, mechanic.applyEffect, time, `${mechanic.id}-${player.id}-eff`, players);
          }
        }
        mechanic.resolved = true;
        continue;
      }
      if (mechanic.targeting && mechanic.shape.kind === "circle") {
        const mBoss = bossFor(bosses, mechanic.bossId);
        const target = mechanic.targeting.mode === "aggro"
          ? players.find(p => p.alive && p.id === mBoss.currentTarget) ?? null
          : selectTargetPlayer(players, mBoss.pos, mechanic.targeting.mode, mechanic.targeting.role);
        if (!target) { mechanic.resolved = true; continue; } // no valid target: fizzle, no telegraph flash
        mechanic.shape = { kind: "circle", center: { x: target.pos.x, z: target.pos.z }, radius: mechanic.shape.radius };
        // The center was hidden until now (see the targeting-cast promotion above), so it becomes
        // visible only from this point, lingering briefly after resolve like other targeted hits.
        if (mechanic.showTelegraph) {
          mechanic.floorAoe = new FloorAoe({
            id: mechanic.id, shape: mechanic.shape, color: mechanic.color ?? DEFAULT_DANGER_COLOR,
            resolveMode: { kind: "resolve", lead: 0, trail: TARGETED_LINGER }, resolveAt: mechanic.resolveAt,
          });
        }
      }
      const mechBoss = bossFor(bosses, mechanic.bossId);
      const balancedOrders = mechanic.applyEffects?.order === "shuffleBalanced"
        ? balancedEffectOrders(
          mechanic.applyEffects.effects,
          players.filter(player =>
            player.alive
            && (!mechanic.positional || inPositionalArc(mechBoss, player.pos, mechanic.positional))
            && pointInShape(mechanic.shape, player.pos)).length,
          randInt,
        )
        : [];
      let balancedOrderIndex = 0;
      for (const player of players) {
        if (!player.alive) continue;
        const inArc = !mechanic.positional || inPositionalArc(mechBoss, player.pos, mechanic.positional);
        const hit = mechanic.requireFullHp
          ? player.hp < player.maxHp
          : pointInShape(mechanic.shape, player.pos) && inArc;
        if (hit) {
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
    pendingDashes: remainingPendingDashes,
    pendingEffectBursts: remainingPendingEffectBursts,
  };
}
