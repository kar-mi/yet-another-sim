import type { Crystal, CrystalElement } from "@shared/types";
import type { Vec2 } from "@shared/math";
import { randomInt } from "@shared/rng";
import { toVec2 } from "./eventTransforms";
import type { RaidDef } from "./raidSchema";

type CrystalConfig = NonNullable<RaidDef["crystals"]>;

function crystal(element: CrystalElement, pos: Vec2, spawnAt: number): Crystal {
  return { id: `crystal-${element}`, element, pos, spawnAt };
}

export function placeCrystals(
  config: CrystalConfig | undefined,
  rngState: number,
): { crystals: Crystal[]; rngState: number } {
  if (!config) return { crystals: [], rngState };

  const crystals: Crystal[] = [];
  let nextState = rngState;
  for (const entry of config) {
    const spawnAt = entry.spawnAt ?? 0;
    if (entry.kind === "single") {
      crystals.push(crystal(entry.element, toVec2(entry.pos), spawnAt));
      continue;
    }

    const emptyRoll = randomInt(nextState, 4);
    const emptyIndex = emptyRoll.value;
    const windIndex = (emptyIndex + 2) % 4;
    const remaining = [0, 1, 2, 3].filter(i => i !== emptyIndex && i !== windIndex);
    const swapRoll = randomInt(emptyRoll.state, 2);
    const [fireIndex, waterIndex] = swapRoll.value === 0 ? remaining : [remaining[1]!, remaining[0]!];
    crystals.push(
      crystal("wind", toVec2(entry.spots[windIndex]!), spawnAt),
      crystal("fire", toVec2(entry.spots[fireIndex]!), spawnAt),
      crystal("water", toVec2(entry.spots[waterIndex]!), spawnAt),
    );
    nextState = swapRoll.state;
  }

  return { crystals, rngState: nextState };
}
