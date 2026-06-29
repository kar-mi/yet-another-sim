import type { TickContext } from "../systems/context";
import type { AOEShape, DamageType, EffectBehavior, Knockback, Player, StatusEffect } from "@shared/types";
import type { Vec2 } from "@shared/math";
import { dot, length, sub } from "@shared/math";
import { sin, cos } from "@shared/dmath";
import { pointInShape } from "../shapes";
import { addResolvedAoeVisual } from "../systems/effectResolvers";
import { applyKnockback, applyMechanicDamage, effectActiveDt, selectTargetPlayers } from "../systems/helpers";

export type ExpiryScratch = {
  resolvedCrystalFollowUps: Set<string>;
};

type BurstSpread = Extract<EffectBehavior, { kind: "burstSpread" }>;

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

export function modifyMitigation(effect: StatusEffect, dealt: number, damageType: DamageType): { dealt: number } {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "mitigation" }>;
  return { dealt: behavior.damageType === undefined || behavior.damageType === damageType ? dealt * behavior.multiplier : dealt };
}

export function modifyVuln(effect: StatusEffect, dealt: number, damageType: DamageType): { dealt: number; consume?: boolean } {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "vuln" }>;
  if (behavior.damageType !== damageType) return { dealt };
  return { dealt: dealt * behavior.multiplier, consume: true };
}

export function primordialCrustOnLethal(): boolean {
  return true;
}

export function directionalKnockback(effect: StatusEffect, player: Player, knockback: Knockback, origin: Vec2): Knockback {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "directionalKnockback" }>;
  const away = sub(player.pos, origin);
  const dir = length(away) > 0 ? { x: away.x / length(away), z: away.z / length(away) } : { x: 1, z: 0 };
  const facingDir = { x: sin(player.facing), z: cos(player.facing) };
  const isFacingAway = dot(facingDir, dir) > 0;
  const correct = behavior.requiredFacing === "away" ? isFacingAway : !isFacingAway;
  return { ...knockback, distance: correct ? behavior.distance : behavior.doubledDistance };
}

export function confusionOnApply(_effect: StatusEffect, player: Player, players: Player[]): Partial<StatusEffect> {
  return { lockedTargetId: closestOtherPlayer(player, players)?.id };
}

export function applyPendingBurstSpreadFollowUp(ctx: TickContext, pending: TickContext["pendingBurstSpreadFollowUps"][number]): void {
  const origin = ctx.world.crystals.find(crystal => crystal.element === pending.originCrystal)?.pos ?? { x: 0, z: 0 };
  resolveFollowUp(ctx, pending.id, pending.name, pending.followUp, origin);
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

function closestOtherPlayer(self: Player, players: Player[]): Player | null {
  let best: Player | null = null;
  let bestDist = Infinity;
  for (const player of players) {
    if (player === self || player.id === self.id || !player.alive) continue;
    const dist = length(sub(player.pos, self.pos));
    if (dist < bestDist) {
      bestDist = dist;
      best = player;
    }
  }
  return best;
}
