import type { EffectBehavior, Player, StatusEffect } from "@shared/types";

export type EffectIcon = { glyph?: string; src?: string; rotate?: number };

export type BehaviorModule = {
  disablesInput?: boolean;
  icon?: (effect: StatusEffect) => EffectIcon;
};

function teleportentIcon([x, z]: [number, number]): string {
  if (Math.abs(x) > Math.abs(z)) {
    return x >= 0 ? "teleportent_right.png" : "teleportent_left.png";
  }
  return z >= 0 ? "teleportent_up.png" : "teleportent_down.png";
}

export const BEHAVIOR_REGISTRY: Record<EffectBehavior["kind"], BehaviorModule> = {
  none: {},
  vuln: { icon: () => ({ glyph: "▼" }) },
  mitigation: {},
  dot: {
    icon: effect => {
      const behavior = effect.behavior as Extract<EffectBehavior, { kind: "dot" }>;
      return { glyph: behavior.condition === "moving" ? "🔥" : behavior.condition === "idle" ? "❄" : "🩸" };
    },
  },
  confusion: { disablesInput: true, icon: () => ({ src: "confuse.png" }) },
  sleep: { disablesInput: true, icon: () => ({ src: "sleep.png" }) },
  burstSpread: {},
  plant: {
    icon: effect => {
      const behavior = effect.behavior as Extract<EffectBehavior, { kind: "plant" }>;
      return { src: teleportentIcon(behavior.direction) };
    },
  },
  directionalKnockback: {
    icon: effect => {
      const behavior = effect.behavior as Extract<EffectBehavior, { kind: "directionalKnockback" }>;
      return { src: `${behavior.requiredFacing === "toward" ? "headwind" : "tailwind"}.png` };
    },
  },
  escalating: {},
  primordialCrust: { icon: () => ({ src: "primoridial_crust.png" }) },
  accretion: { icon: () => ({ src: "accretion.png" }) },
  assignment: {},
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
