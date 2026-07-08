import { makeSeed } from "@shared/rng";
import { preRollRaid } from "./preRoll";
import type { RaidDef } from "./raidSchema";

export type DecisionDescription = { key: string; label: string; options: string[] };

function rangeLabels(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);
}

export function describeDecisions(raid: RaidDef): DecisionDescription[] {
  const decisions: DecisionDescription[] = [];
  const combinations = raid.optionals?.combinations;
  const plant = combinations?.plant;
  if (plant?.rng) decisions.push({ key: "plant-swap", label: "Plant groups", options: ["normal", "swapped"] });

  const pairings = combinations?.pairings;
  if (pairings?.rng && pairings.patterns.length > 1) {
    decisions.push({ key: "pairings", label: "Pairings", options: rangeLabels(pairings.patterns.length, "pattern") });
  }

  raid.crystals?.forEach((entry, i) => {
    if (entry.kind !== "rotatingTrio") return;
    decisions.push(
      { key: `crystals-${i}-empty`, label: `Crystals ${i + 1} empty spot`, options: rangeLabels(4, "spot") },
      { key: `crystals-${i}-swap`, label: `Crystals ${i + 1} fire/water`, options: ["normal", "swapped"] },
    );
  });

  if (raid.optionals?.towerRng) {
    decisions.push(
      { key: "towers-offset", label: "Tower start", options: rangeLabels(8, "spot") },
      { key: "towers-direction", label: "Tower direction", options: ["clockwise", "counter-clockwise"] },
    );
  }

  const endings = combinations?.endings;
  if (endings?.rng) {
    endings.events.forEach((_, i) => {
      decisions.push({
        key: `ending-${i}`,
        label: `Ending ${i + 1}`,
        options: endings.variants.map((variant, j) => variant.name ?? `variant ${j + 1}`),
      });
    });
  }

  if (raid.optionals?.orderSwap?.rng) {
    decisions.push({ key: "order-swap", label: "Order swap", options: ["normal", "swapped"] });
  }

  const sweep = raid.optionals?.divebombSweep;
  if (sweep?.rng) {
    decisions.push(
      { key: "divebomb-start", label: "Divebomb start", options: rangeLabels(sweep.events.length, "spot") },
      { key: "divebomb-direction", label: "Divebomb direction", options: ["clockwise", "counter-clockwise"] },
    );
  }

  const eventSets = combinations?.eventSets;
  if (eventSets) {
    for (const [key, setConfig] of Object.entries(eventSets)) {
      if (setConfig.rng && setConfig.sets.length > 1) {
        decisions.push({ key: `event-set-${key}`, label: `Event set ${key}`, options: rangeLabels(setConfig.sets.length, "set") });
      }
    }
  }

  for (const event of raid.events) {
    if (event.type !== "hazard" || !event.blackHole) continue;
    decisions.push(
      { key: `black-hole-${event.id}-combo`, label: `${event.name} combo`, options: rangeLabels(event.blackHole.combos.length, "combo") },
      { key: `black-hole-${event.id}-rotation`, label: `${event.name} rotation`, options: ["0", "90", "180", "270"] },
    );
  }

  return decisions;
}

export function findSeed(raid: RaidDef, constraints: Record<string, number>, maxTries = 20000): number | null {
  for (let i = 0; i < maxTries; i++) {
    const seed = makeSeed();
    const decisions = preRollRaid(raid, seed).decisions;
    if (Object.entries(constraints).every(([key, value]) => decisions[key] === value)) return seed;
  }
  return null;
}
