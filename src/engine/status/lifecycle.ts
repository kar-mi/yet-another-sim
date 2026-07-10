import type { TickContext } from "../systems/context";
import type { AOEShape, DamageType, EffectBehavior, Player, StatusEffect } from "@shared/types";
import type { Vec2 } from "@shared/math";
import { pointInShape } from "../shapes";
import { addResolvedAoeVisual } from "../systems/effectResolvers";
import { applyEffect, applyKnockback, applyMechanicDamage, effectActiveDt, isLookingAt, selectTargetPlayers } from "../systems/helpers";
import { GRAVITY } from "@shared/constants";
import { sin, cos } from "@shared/dmath";

export type ExpiryScratch = {
  resolvedCrystalFollowUps: Set<string>;
  resolvedPairedSpreadStacks: Set<string>;
};

type StatusLifecycleModule = {
  onTick?: (effect: StatusEffect, player: Player, ctx: TickContext, acted: boolean) => void;
  cleanseOnFullHp?: boolean;
  onExpiry?: (effect: StatusEffect, player: Player, ctx: TickContext, scratch: ExpiryScratch) => void;
};

type BurstSpread = Extract<EffectBehavior, { kind: "burstSpread" }>;

export const STATUS_LIFECYCLE_REGISTRY: Record<EffectBehavior["kind"], StatusLifecycleModule> = {
  none: {},
  vuln: {},
  mitigation: {},
  dot: { onTick: dotOnTick },
  confusion: {},
  sleep: {},
  burstSpread: { onExpiry: burstSpreadOnExpiry },
  effectBurst: { onExpiry: effectBurstOnExpiry },
  twister: { onExpiry: twisterOnExpiry },
  carrierGaze: { onExpiry: carrierGazeOnExpiry },
  reverseCarrierGaze: { onExpiry: reverseCarrierGazeOnExpiry },
  pairedSpreadStack: { onExpiry: pairedSpreadStackOnExpiry },
  effectCheck: { onExpiry: effectCheckOnExpiry },
  plant: { onExpiry: plantOnExpiry },
  directionalKnockback: {},
  escalating: {},
  primordialCrust: { onExpiry: expiryDamageOnExpiry },
  accretion: { cleanseOnFullHp: true, onExpiry: expiryDamageOnExpiry },
  motionCheck: { onExpiry: motionCheckOnExpiry },
  assignment: { onExpiry: expiryDamageOnExpiry },
};

export function dotOnTick(effect: StatusEffect, player: Player, ctx: TickContext, acted: boolean): void {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "dot" }>;
  const activeDt = effectActiveDt(effect, ctx.previousTime, ctx.time);
  if (activeDt <= 0) return;
  const ticks = behavior.condition === "always"
    || (behavior.condition === "moving" && acted)
    || (behavior.condition === "idle" && !acted);
  if (!ticks) return;
  player.hp = Math.max(0, player.hp - behavior.dps * activeDt);
  if (player.hp <= 0) {
    player.alive = false;
    ctx.log.push({ t: ctx.time, mechanic: effect.name, playerId: player.id, event: "hit" });
  }
}

export function burstSpreadOnExpiry(effect: StatusEffect, player: Player, ctx: TickContext, scratch: ExpiryScratch): void {
  const behavior = effect.behavior as BurstSpread;
  const selfShape: AOEShape = (behavior.selfShape ?? "circle") === "donut"
    ? { kind: "donut", center: player.pos, inner: behavior.selfInner!, outer: behavior.radius }
    : { kind: "circle", center: player.pos, radius: behavior.radius };
  applyShapeHit(ctx.players, ctx.log, ctx.time, selfShape, player.pos, behavior.damage, behavior.damageType, behavior.knockbackDistance, player.id, effect.name);
  addResolvedAoeVisual(ctx, `${effect.id}-self`, effect.name, selfShape);
  if (!behavior.followUp) return;

  const followUp = behavior.followUp;
  if (followUp.originCrystal !== undefined) {
    const key = `${effect.name}:${followUp.originCrystal}`;
    if (scratch.resolvedCrystalFollowUps.has(key)) return;
    scratch.resolvedCrystalFollowUps.add(key);
    ctx.pendingBurstSpreadFollowUps.push({
      id: effect.id,
      t: ctx.time + 1,
      name: effect.name,
      originCrystal: followUp.originCrystal,
      followUp,
    });
    return;
  }
  resolveFollowUp(ctx, effect.id, effect.name, followUp, player.pos, player.id);
}

export function effectBurstOnExpiry(effect: StatusEffect, player: Player, ctx: TickContext): void {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "effectBurst" }>;
  const shape: AOEShape = behavior.shape === "donut"
    ? { kind: "donut", center: player.pos, inner: behavior.innerRadius!, outer: behavior.radius }
    : { kind: "circle", center: player.pos, radius: behavior.radius };
  applyShapeHit(ctx.players, ctx.log, ctx.time, shape, player.pos, behavior.damage, behavior.damageType, undefined, undefined, effect.name);
  addResolvedAoeVisual(ctx, `${effect.id}-burst`, effect.name, shape);
}

export function twisterOnExpiry(effect: StatusEffect, player: Player, ctx: TickContext): void {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "twister" }>;
  const inverted = behavior.questionMark ?? (behavior.rng ? ctx.randFloat() < 0.5 : false);
  const shapeKind = inverted ? behavior.hiddenShape : behavior.shownShape;
  const center = { x: player.pos.x, z: player.pos.z };
  const shape: AOEShape = shapeKind === "donut"
    ? { kind: "donut", center, inner: behavior.innerRadius!, outer: behavior.radius }
    : { kind: "circle", center, radius: behavior.radius };
  ctx.pendingTwisters.push({
    id: effect.id,
    t: ctx.time + behavior.delay,
    name: effect.name,
    shape,
    damage: behavior.damage,
    damageType: behavior.damageType,
  });
}

export function carrierGazeOnExpiry(effect: StatusEffect, player: Player, ctx: TickContext): void {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "carrierGaze" }>;
  const shape: AOEShape = {
    kind: "cone",
    origin: player.pos,
    direction: { x: sin(player.facing), z: cos(player.facing) },
    ...behavior.cone,
  };
  applyShapeHit(ctx.players, ctx.log, ctx.time, shape, player.pos, behavior.damage, behavior.damageType, undefined, player.id, effect.name);
  addResolvedAoeVisual(ctx, `${effect.id}-cone`, effect.name, shape);
}

export function reverseCarrierGazeOnExpiry(effect: StatusEffect, player: Player, ctx: TickContext): void {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "reverseCarrierGaze" }>;
  const halfAngle = behavior.coneHalfAngle ?? Math.PI / 2;
  for (const target of ctx.players) {
    if (!target.alive || target.id === player.id) continue;
    if (isLookingAt(target.facing, target.pos, player.pos, halfAngle)) continue;
    applyMechanicDamage(target, behavior.damage, behavior.damageType, ctx.time);
    ctx.log.push({ t: ctx.time, mechanic: effect.name, playerId: target.id, event: "hit" });
  }
}

export function pairedSpreadStackOnExpiry(effect: StatusEffect, _player: Player, ctx: TickContext, scratch: ExpiryScratch): void {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "pairedSpreadStack" }>;
  if (scratch.resolvedPairedSpreadStacks.has(behavior.key)) return;
  scratch.resolvedPairedSpreadStacks.add(behavior.key);
  const carriers = ctx.players.flatMap(player => player.effects
    .filter(candidate => candidate.behavior.kind === "pairedSpreadStack"
      && candidate.behavior.key === behavior.key
      && candidate.appliedAt + candidate.duration > ctx.previousTime
      && candidate.appliedAt + candidate.duration <= ctx.time)
    .map(candidate => ({ player, behavior: candidate.behavior as Extract<EffectBehavior, { kind: "pairedSpreadStack" }> })));
  const stackCarriers = carriers.filter(carrier => carrier.behavior.role === "stack");
  const spreadCarriers = carriers.filter(carrier => carrier.behavior.role === "spread");
  for (const { player } of spreadCarriers) {
    const shape: AOEShape = { kind: "circle", center: player.pos, radius: behavior.spread.radius };
    applyShapeHit(ctx.players, ctx.log, ctx.time, shape, player.pos, behavior.spread.damage, behavior.damageType, undefined, undefined, effect.name);
    addResolvedAoeVisual(ctx, `${effect.id}-spread-${player.id}`, effect.name, shape);
  }
  for (const { player } of stackCarriers) {
    const shape: AOEShape = { kind: "circle", center: player.pos, radius: behavior.stack.radius };
    const soakers = ctx.players.filter(target => target.alive && pointInShape(shape, target.pos));
    const per = soakers.length >= behavior.stack.requiredCount ? behavior.stack.damage / soakers.length : behavior.stack.damage;
    for (const soaker of soakers) {
      applyMechanicDamage(soaker, per, behavior.damageType, ctx.time);
      ctx.log.push({ t: ctx.time, mechanic: effect.name, playerId: soaker.id, event: "hit" });
    }
    addResolvedAoeVisual(ctx, `${effect.id}-stack-${player.id}`, effect.name, shape);
  }
}

export function effectCheckOnExpiry(effect: StatusEffect, player: Player, ctx: TickContext): void {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "effectCheck" }>;
  const [left, right] = behavior.compare.map(group => player.effects.find(candidate => candidate.group === group)?.name);
  const passes = left !== undefined && right !== undefined
    && (behavior.expect === "matches" ? left === right : left !== right);
  if (passes) {
    ctx.log.push({ t: ctx.time, mechanic: effect.name, playerId: player.id, event: "cleared" });
    return;
  }
  applyMechanicDamage(player, behavior.failureDamage, behavior.failureDamageType, ctx.time);
  ctx.log.push({ t: ctx.time, mechanic: effect.name, playerId: player.id, event: "hit" });
}

export function plantOnExpiry(effect: StatusEffect, player: Player, ctx: TickContext): void {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "plant" }>;
  ctx.forcedMarches.push({
    id: `plant-${player.id}-${effect.id}`,
    name: effect.name,
    pos: { x: player.pos.x, z: player.pos.z },
    radius: behavior.radius,
    direction: { x: behavior.direction[0], z: behavior.direction[1] },
    distance: behavior.distance,
    preDelay: behavior.tpDelay,
    postDelay: 0.3,
    relativeMove: true,
    armedAt: ctx.time + behavior.armDelay,
    expireAt: ctx.time + behavior.armDelay + behavior.duration,
    triggered: false,
    teleported: false,
  });
}

export function expiryDamageOnExpiry(effect: StatusEffect, player: Player, ctx: TickContext): void {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "primordialCrust" | "accretion" | "assignment" }>;
  applyMechanicDamage(player, behavior.expiryDamage, behavior.expiryDamageType, ctx.time);
  if (!player.alive) ctx.log.push({ t: ctx.time, mechanic: effect.name, playerId: player.id, event: "hit" });
}

export function motionCheckOnExpiry(effect: StatusEffect, player: Player, ctx: TickContext): void {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "motionCheck" }>;
  const moved = (player.lastMotionAt ?? -Infinity) >= ctx.time - behavior.window;
  if (behavior.required === "move" ? moved : !moved) return;
  // ponytail: micro-distance keeps the existing knockup input lock without a new player state.
  applyKnockback(player, { distance: 0.001, height: behavior.failureKnockupHeight }, player.pos, ctx.time);
  applyEffect(player, {
    name: effect.name,
    kind: "debuff",
    duration: 2 * Math.sqrt(2 * GRAVITY * behavior.failureKnockupHeight) / GRAVITY,
    visibility: "invisible",
    behavior: { kind: "assignment", expiryDamage: behavior.failureDamage, expiryDamageType: behavior.failureDamageType },
  }, ctx.time, `${effect.id}-landing`, ctx.players);
}

export function applyPendingBurstSpreadFollowUp(ctx: TickContext, pending: TickContext["pendingBurstSpreadFollowUps"][number]): void {
  const origin = ctx.world.crystals.find(crystal => crystal.element === pending.originCrystal)?.pos ?? { x: 0, z: 0 };
  resolveFollowUp(ctx, pending.id, pending.name, pending.followUp, origin);
}

export function applyPendingTwister(ctx: TickContext, pending: TickContext["pendingTwisters"][number]): void {
  const origin = pending.shape.kind === "circle" || pending.shape.kind === "donut"
    ? pending.shape.center
    : pending.shape.origin;
  applyShapeHit(ctx.players, ctx.log, ctx.time, pending.shape, origin, pending.damage, pending.damageType, undefined, undefined, pending.name);
  addResolvedAoeVisual(ctx, `${pending.id}-twister`, pending.name, pending.shape);
}

function applyShapeHit(
  players: TickContext["players"],
  log: TickContext["log"],
  time: number,
  shape: AOEShape,
  origin: Vec2,
  damage: number,
  damageType: DamageType,
  kbDistance: number | undefined,
  skipKbForId: string | undefined,
  name: string,
): void {
  for (const target of players) {
    if (!target.alive || !pointInShape(shape, target.pos)) continue;
    applyMechanicDamage(target, damage, damageType, time);
    if (kbDistance !== undefined && kbDistance > 0 && (skipKbForId === undefined || target.id !== skipKbForId) && target.antiKbActive <= 0) {
      applyKnockback(target, { distance: kbDistance, height: 0, origin }, origin, time);
    }
    log.push({ t: time, mechanic: name, playerId: target.id, event: "hit" });
  }
}

function resolveFollowUp(ctx: TickContext, id: string, name: string, followUp: NonNullable<BurstSpread["followUp"]>, origin: Vec2, excludeId?: string): void {
  const candidates = excludeId === undefined
    ? ctx.players.filter(p => p.alive)
    : ctx.players.filter(p => p.alive && p.id !== excludeId);
  const targets = selectTargetPlayers(candidates, origin, followUp.mode, followUp.count);
  for (const target of targets) {
    const shape: AOEShape = followUp.shape === "donut"
      ? { kind: "donut", center: target.pos, inner: followUp.inner!, outer: followUp.radius }
      : { kind: "circle", center: target.pos, radius: followUp.radius };
    applyShapeHit(ctx.players, ctx.log, ctx.time, shape, target.pos, followUp.damage, followUp.damageType, followUp.knockbackDistance, undefined, name);
    addResolvedAoeVisual(ctx, `${id}-fu-${target.id}`, name, shape);
  }
}
