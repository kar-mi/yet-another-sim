import type { EffectSpec } from "@shared/types";

export const DEBUFF_REGISTRY: Record<string, EffectSpec> = {
  "Magic Vulnerability": {
    name: "Magic Vulnerability",
    kind: "debuff",
    duration: 8,
    behavior: { kind: "vuln", damageType: "magical", multiplier: 1.5 },
  },
} satisfies Record<string, EffectSpec>;

type EffectRefOverrides = Partial<Omit<EffectSpec, "behavior">> & {
  behavior?: Partial<EffectSpec["behavior"]>;
};

export type EffectRef = EffectRefOverrides & { ref: string };

export function resolveEffectRef({ ref, ...overrides }: EffectRef): EffectSpec | undefined {
  const base = DEBUFF_REGISTRY[ref];
  if (!base) return undefined;
  return {
    ...base,
    ...overrides,
    behavior: overrides.behavior
      ? { ...base.behavior, ...overrides.behavior } as EffectSpec["behavior"]
      : base.behavior,
  };
}
