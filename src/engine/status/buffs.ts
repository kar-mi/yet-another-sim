import type { EffectSpec } from "@shared/types";

export const BUFF_REGISTRY: Record<string, EffectSpec> = {
  tank_limit_break: {
    name: "Tank Limit Break",
    kind: "buff",
    duration: 10,
    behavior: { kind: "mitigation", multiplier: 0.1 },
  },
} satisfies Record<string, EffectSpec>;
