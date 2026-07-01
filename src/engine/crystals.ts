import type { Crystal, CrystalElement } from "@shared/types";
import type { Vec2 } from "@shared/math";
import { randomInt } from "@shared/rng";
import { toVec2 } from "./eventTransforms";
import type { RaidDef } from "./raidSchema";

type CrystalConfig = NonNullable<RaidDef["crystals"]>;

const ELEMENTS: CrystalElement[] = ["wind", "fire", "water", "earth"];

function crystal(element: CrystalElement, pos: Vec2, spawnAt: number): Crystal {
  return { id: `crystal-${element}`, element, pos, spawnAt };
}

export function placeCrystals(
  config: CrystalConfig | undefined,
  rngState: number,
): { crystals: Crystal[]; rngState: number } {
  if (!config) return { crystals: [], rngState };

  const spawnAt = config.spawnAt ?? 0;
  if (!config.rng) {
    return {
      crystals: ELEMENTS.map((element, i) => crystal(element, toVec2(config.spots[i]!), spawnAt)),
      rngState,
    };
  }

  const emptyRoll = randomInt(rngState, 4);
  const emptyIndex = emptyRoll.value;
  const windIndex = (emptyIndex + 2) % 4;
  const remaining = [0, 1, 2, 3].filter(i => i !== emptyIndex && i !== windIndex);
  const swapRoll = randomInt(emptyRoll.state, 2);
  const [fireIndex, waterIndex] = swapRoll.value === 0 ? remaining : [remaining[1]!, remaining[0]!];

  return {
    crystals: [
      crystal("wind", toVec2(config.spots[windIndex]!), spawnAt),
      crystal("fire", toVec2(config.spots[fireIndex]!), spawnAt),
      crystal("water", toVec2(config.spots[waterIndex]!), spawnAt),
    ],
    rngState: swapRoll.state,
  };
}
