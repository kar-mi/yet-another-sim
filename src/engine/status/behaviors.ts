import type { DamageType, EffectBehavior, EffectSpec, Knockback, Player, StatusEffect } from "@shared/types";
import type { Vec2 } from "@shared/math";
import type { TickContext } from "../systems/context";
import {
  burstSpreadOnExpiry,
  confusionOnApply,
  directionalKnockback,
  dotOnTick,
  expiryDamageOnExpiry,
  modifyMitigation,
  modifyVuln,
  plantOnExpiry,
  primordialCrustOnLethal,
  type ExpiryScratch,
} from "./lifecycle";

export type EffectIcon = { glyph?: string; src?: string; rotate?: number };

export type BehaviorModule = {
  disablesInput?: boolean;
  icon?: (effect: StatusEffect) => EffectIcon;
  onTick?: (effect: StatusEffect, player: Player, ctx: TickContext, acted: boolean) => void;
  cleanseOnFullHp?: boolean;
  onExpiry?: (effect: StatusEffect, player: Player, ctx: TickContext, scratch: ExpiryScratch) => void;
  modifyDamage?: (effect: StatusEffect, dealt: number, damageType: DamageType) => { dealt: number; consume?: boolean };
  onLethal?: (effect: StatusEffect, player: Player) => boolean;
  modifyKnockback?: (effect: StatusEffect, player: Player, knockback: Knockback, origin: Vec2, time: number) => Knockback;
  onApply?: (effect: StatusEffect, player: Player, players: Player[], spec: EffectSpec) => Partial<StatusEffect>;
};

function teleportentIcon([x, z]: [number, number]): string {
  if (Math.abs(x) > Math.abs(z)) {
    return x >= 0 ? "teleportent_right.png" : "teleportent_left.png";
  }
  return z >= 0 ? "teleportent_up.png" : "teleportent_down.png";
}

export const BEHAVIOR_REGISTRY: Record<EffectBehavior["kind"], BehaviorModule> = {
  none: {},
  vuln: { icon: () => ({ glyph: "▼" }), modifyDamage: modifyVuln },
  mitigation: { modifyDamage: modifyMitigation },
  dot: {
    onTick: dotOnTick,
    icon: effect => {
      const behavior = effect.behavior as Extract<EffectBehavior, { kind: "dot" }>;
      return { glyph: behavior.condition === "moving" ? "🔥" : behavior.condition === "idle" ? "❄" : "🩸" };
    },
  },
  confusion: { disablesInput: true, icon: () => ({ src: "confuse.png" }), onApply: confusionOnApply },
  sleep: { disablesInput: true, icon: () => ({ src: "sleep.png" }) },
  burstSpread: { onExpiry: burstSpreadOnExpiry },
  plant: {
    onExpiry: plantOnExpiry,
    icon: effect => {
      const behavior = effect.behavior as Extract<EffectBehavior, { kind: "plant" }>;
      return { src: teleportentIcon(behavior.direction) };
    },
  },
  directionalKnockback: {
    modifyKnockback: directionalKnockback,
    icon: effect => {
      const behavior = effect.behavior as Extract<EffectBehavior, { kind: "directionalKnockback" }>;
      return { src: `${behavior.requiredFacing === "toward" ? "headwind" : "tailwind"}.png` };
    },
  },
  primordialCrust: { icon: () => ({ src: "primoridial_crust.png" }), onExpiry: expiryDamageOnExpiry, onLethal: primordialCrustOnLethal },
  accretion: { icon: () => ({ src: "accretion.png" }), cleanseOnFullHp: true, onExpiry: expiryDamageOnExpiry },
  assignment: { onExpiry: expiryDamageOnExpiry },
};

export function effectIcon(effect: StatusEffect): EffectIcon {
  return BEHAVIOR_REGISTRY[effect.behavior.kind].icon?.(effect)
    ?? { glyph: effect.kind === "buff" ? "▲" : "●" };
}

export function hasInputDisablingEffect(player: Player, time: number): boolean {
  return player.effects.some(effect =>
    effect.appliedAt + effect.duration > time
    && BEHAVIOR_REGISTRY[effect.behavior.kind].disablesInput === true
  );
}
