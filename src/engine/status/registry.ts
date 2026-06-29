import type { EffectSpec } from "@shared/types";
import { BUFF_REGISTRY } from "./buffs";
import { DEBUFF_REGISTRY } from "./debuffs";

const STATUS_REGISTRY: Record<string, EffectSpec> = {
  ...BUFF_REGISTRY,
  ...DEBUFF_REGISTRY,
};

type EffectRefOverrides = Partial<Omit<EffectSpec, "behavior">> & {
  behavior?: Partial<EffectSpec["behavior"]>;
};

export type EffectRef = EffectRefOverrides & { ref: string };

export function resolveEffectRef({ ref, ...overrides }: EffectRef): EffectSpec | undefined {
  const base = STATUS_REGISTRY[ref];
  if (!base) return undefined;
  return {
    ...base,
    ...overrides,
    behavior: overrides.behavior
      ? { ...base.behavior, ...overrides.behavior } as EffectSpec["behavior"]
      : base.behavior,
  };
}
