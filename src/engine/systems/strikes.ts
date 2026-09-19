import type { AOEShape, DamageType } from "@shared/types";
import type { ShapeKnockback } from "@status";
import type { TickContext } from "./context";
import type { DamageSource } from "./damageLog";
import { pointInShape } from "../shapes";
import { applyMechanicDamage, knockbackPlayer } from "./helpers";

export type ShapeHitPolicy = { knockback?: ShapeKnockback; excludeId?: string };

export function hitPlayersInShape(ctx: TickContext, shape: AOEShape, damage: number, damageType: DamageType, source: DamageSource, policy: ShapeHitPolicy = {}): void {
  const { knockback, excludeId } = policy;
  for (const target of ctx.players) {
    if (!target.alive || target.id === excludeId || !pointInShape(shape, target.pos)) continue;
    applyMechanicDamage(ctx, target, damage, damageType, source);
    if (knockback && target.id !== knockback.exemptId) {
      knockbackPlayer(target, { distance: knockback.distance, height: 0, origin: knockback.origin }, knockback.origin, ctx.time);
    }
    ctx.log.push({ t: ctx.time, mechanic: source.name, playerId: target.id, event: "hit" });
  }
}

export function resolveStackShare(ctx: TickContext, shape: AOEShape, stack: { damage: number; requiredCount: number }, damageType: DamageType, source: DamageSource): boolean {
  const soakers = ctx.players.filter(player => player.alive && pointInShape(shape, player.pos));
  const success = soakers.length >= stack.requiredCount;
  const per = success ? stack.damage / soakers.length : stack.damage;
  for (const soaker of soakers) {
    applyMechanicDamage(ctx, soaker, per, damageType, source);
    ctx.log.push({ t: ctx.time, mechanic: source.name, playerId: soaker.id, event: "hit" });
  }
  return success;
}
