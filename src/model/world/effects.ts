import type { StatusSpec as EffectSpec } from "@status";

export type {
  Knockback,
  StatusInstance as StatusEffect,
  StatusSpec as EffectSpec,
  StatusBundle as EffectBundle,
} from "@status";

export type ReassignCharge = {
  kind: string;
  effect: EffectSpec;
  marker?: EffectSpec;
};

export type Reassign = {
  id: string;
  t: number;
  name: string;
  charges: ReassignCharge[];
  initial?: "plan";
  onResolve?: Record<string, Record<string, number>>;
  initialDealt: boolean;
};
