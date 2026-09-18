import type { ActiveMechanic } from "@shared/types";

export type SealedImplement = "bow" | "harp";

const SEALED_IMPLEMENTS_CAST = /^sealed-implements-\d+-(bow|harp)$/;

// The Index's weapon to outline while its Sealed Implements cast bar is up (omni-elements-1.yaml).
export function selectSealedImplement(active: ActiveMechanic[]): SealedImplement | null {
  for (const mechanic of active) {
    if (mechanic.resolved) continue;
    const match = SEALED_IMPLEMENTS_CAST.exec(mechanic.id);
    if (match) return match[1] as SealedImplement;
  }
  return null;
}
