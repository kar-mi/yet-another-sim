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
  constraints: Readonly<Record<string, number>> = {},
): { crystals: Crystal[]; rngState: number; rolls: { emptyIndex: number; swap: number }[] } {
  if (!config) return { crystals: [], rngState, rolls: [] };

  const crystals: Crystal[] = [];
  const rolls: { emptyIndex: number; swap: number }[] = [];
  let nextState = rngState;
  for (const [entryIndex, entry] of config.entries()) {
    const spawnAt = entry.spawnAt ?? 0;
    if (entry.kind === "single") {
      crystals.push(crystal(entry.element, toVec2(entry.pos), spawnAt));
      continue;
    }

    const emptyRoll = randomInt(nextState, 4);
    const emptyIndex = constraints[`crystals-${entryIndex}-empty`] ?? emptyRoll.value;
    const windIndex = (emptyIndex + 2) % 4;
    const remaining = [0, 1, 2, 3].filter(i => i !== emptyIndex && i !== windIndex);
    const swapRoll = randomInt(emptyRoll.state, 2);
    const swap = constraints[`crystals-${entryIndex}-swap`] ?? swapRoll.value;
    rolls.push({ emptyIndex, swap });
    const [fireIndex, waterIndex] = swap === 0 ? remaining : [remaining[1]!, remaining[0]!];
    crystals.push(
      crystal("wind", toVec2(entry.spots[windIndex]!), spawnAt),
      crystal("fire", toVec2(entry.spots[fireIndex]!), spawnAt),
      crystal("water", toVec2(entry.spots[waterIndex]!), spawnAt),
    );
    nextState = swapRoll.state;
  }

  return { crystals, rngState: nextState, rolls };
}
