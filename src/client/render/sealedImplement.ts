import type { ActiveMechanic } from "@shared/types";

export type SealedImplement = "bow" | "harp";

const SEALED_IMPLEMENTS_CAST = /^sealed-implements-\d+-(bow|harp)$/;

// Select the weapon for the active Sealed Implements cast.
export function selectSealedImplement(active: ActiveMechanic[]): SealedImplement | null {
  for (const mechanic of active) {
    if (mechanic.resolved) continue;
    const match = SEALED_IMPLEMENTS_CAST.exec(mechanic.id);
    if (match) return match[1] as SealedImplement;
  }
  return null;
}
