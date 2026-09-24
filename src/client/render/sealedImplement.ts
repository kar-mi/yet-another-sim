import type { ActiveMechanic } from "@model/types";
import type { GlowVfx } from "@effects";

type SealedImplement = "bow" | "harp";

export type ImplementHighlight = { weapon: SealedImplement; glow?: GlowVfx };

const SEALED_IMPLEMENTS_CAST = /^sealed-implements-\d+-(bow|harp)$/;

export function selectSealedImplement(active: ActiveMechanic[]): ImplementHighlight | null {
  for (const mechanic of active) {
    if (mechanic.resolved) continue;
    const match = SEALED_IMPLEMENTS_CAST.exec(mechanic.id);
    if (!match) continue;
    const glow = mechanic.vfx?.glow;
    return glow?.enabled === false ? null : { weapon: match[1] as SealedImplement, glow };
  }
  return null;
}
