import type { DamageType, EffectBehavior, EffectSpec, Knockback, Player, StatusEffect } from "@shared/types";
import type { Vec2 } from "@shared/math";
import { dot, length, normalize, sub } from "@shared/math";
import { sin, cos } from "@shared/dmath";

type CombatLifecycleModule = {
  modifyDamage?: (effect: StatusEffect, dealt: number, damageType: DamageType) => { dealt: number; consume?: boolean };
  onLethal?: (effect: StatusEffect, player: Player) => boolean;
  modifyKnockback?: (effect: StatusEffect, player: Player, knockback: Knockback, origin: Vec2, time: number) => Knockback;
  onApply?: (effect: StatusEffect, player: Player, players: Player[], spec: EffectSpec) => Partial<StatusEffect>;
};

export const COMBAT_LIFECYCLE_REGISTRY: Record<EffectBehavior["kind"], CombatLifecycleModule> = {
  none: {},
  vuln: { modifyDamage: modifyVuln },
  mitigation: { modifyDamage: modifyMitigation },
  dot: {},
  confusion: { onApply: confusionOnApply },
  sleep: {},
  burstSpread: {},
  plant: {},
  directionalKnockback: { modifyKnockback: directionalKnockback },
  primordialCrust: { onLethal: primordialCrustOnLethal },
  accretion: {},
  assignment: {},
};

function modifyMitigation(effect: StatusEffect, dealt: number, damageType: DamageType): { dealt: number } {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "mitigation" }>;
  return { dealt: behavior.damageType === undefined || behavior.damageType === damageType ? dealt * behavior.multiplier : dealt };
}

function modifyVuln(effect: StatusEffect, dealt: number, damageType: DamageType): { dealt: number; consume?: boolean } {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "vuln" }>;
  if (behavior.damageType !== damageType) return { dealt };
  return { dealt: dealt * behavior.multiplier, consume: true };
}

function primordialCrustOnLethal(): boolean {
  return true;
}

function directionalKnockback(effect: StatusEffect, player: Player, knockback: Knockback, origin: Vec2): Knockback {
  const behavior = effect.behavior as Extract<EffectBehavior, { kind: "directionalKnockback" }>;
  const away = sub(player.pos, origin);
  const dir = length(away) > 0 ? normalize(away) : { x: 1, z: 0 };
  const facingDir = { x: sin(player.facing), z: cos(player.facing) };
  const isFacingAway = dot(facingDir, dir) > 0;
  const correct = behavior.requiredFacing === "away" ? isFacingAway : !isFacingAway;
  return { ...knockback, distance: correct ? behavior.distance : behavior.doubledDistance };
}

function confusionOnApply(_effect: StatusEffect, player: Player, players: Player[]): Partial<StatusEffect> {
  return { lockedTargetId: closestOtherPlayer(player, players)?.id };
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
