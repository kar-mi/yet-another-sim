import type { BossModelName } from "./raidSchema";

export type BossPreset = {
  model: BossModelName;
  modelScale: number;
  radius: number;
  ring: { scale: number; color: string };
};

export const BOSS_REGISTRY = {
  kefka: { model: "kefka", modelScale: 30, radius: 3, ring: { scale: 2, color: "#e62120" } },
  chaos: { model: "chaos", modelScale: 24, radius: 3, ring: { scale: 2, color: "#e62120" } },
  exdeath: { model: "exdeath", modelScale: 15, radius: 2.5, ring: { scale: 2, color: "#e62120" } },
  skeith: { model: "skeith", modelScale: 1, radius: 3, ring: { scale: 2, color: "#e62120" } },
} as const satisfies Record<string, BossPreset>;

export const DEFAULT_BOSS_ID = "kefka";
export type BossRegistryId = keyof typeof BOSS_REGISTRY;
export const BOSS_REGISTRY_IDS = Object.keys(BOSS_REGISTRY) as [BossRegistryId, ...BossRegistryId[]];

export function isBossRegistryId(id: string): id is BossRegistryId {
  return id in BOSS_REGISTRY;
}
