import type { StatusSpec as EffectSpec } from "@status";

export type {
  Knockback,
  StatusInstance as StatusEffect,
  StatusSpec as EffectSpec,
  StatusBundle as EffectBundle,
} from "@status";

// Generic "reassign" mechanic: distribute named charge debuffs across players, then re-balance to
// target counts after a labelled mechanic resolves. `charges` maps each kind to its effect + marker
// spec; `initial: "plan"` opens by applying world.initialCharges; `onResolve` keys a trigger label
// (e.g. a tower's label) to the per-kind target counts the re-balance should reach, dealt to that
// mechanic's just-resolved players in roster order.
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
  initialDealt: boolean; // runtime: set once the opener (initial) deal has fired
};
