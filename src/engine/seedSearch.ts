import type { DecisionDescription } from "@shared/protocol";
import type { RngConstraints } from "./preRoll";
import type { RaidDef } from "./raidSchema";

function rangeLabels(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);
}

export function describeDecisions(raid: RaidDef): DecisionDescription[] {
  const decisions: DecisionDescription[] = [];
  const add = (decision: DecisionDescription) => {
    const override = raid.optionals?.rngLabels?.[decision.key];
    decisions.push({
      ...decision,
      label: override?.label ?? decision.label,
      options: override?.options?.length === decision.options.length ? override.options : decision.options,
    });
  };
  const combinations = raid.optionals?.combinations;
  const plant = combinations?.plant;
  if (plant?.rng) add({ key: "plant-swap", label: "Plant groups", options: ["normal", "swapped"] });

  const pairings = combinations?.pairings;
  if (pairings?.rng && pairings.patterns.length > 1) {
    add({ key: "pairings", label: "Pairings", options: rangeLabels(pairings.patterns.length, "pattern") });
  }

  raid.crystals?.forEach((entry, i) => {
    if (entry.kind !== "rotatingTrio") return;
    add({ key: `crystals-${i}-empty`, label: `Crystals ${i + 1} empty spot`, options: rangeLabels(4, "spot") });
    add({ key: `crystals-${i}-swap`, label: `Crystals ${i + 1} fire/water`, options: ["normal", "swapped"] });
  });

  if (raid.optionals?.towerRng) {
    add({ key: "towers-offset", label: "Tower start", options: rangeLabels(8, "spot") });
    add({ key: "towers-direction", label: "Tower direction", options: ["clockwise", "counter-clockwise"] });
  }

  const endings = combinations?.endings;
  if (endings?.rng) {
    endings.events.forEach((_, i) => {
      add({
        key: `ending-${i}`,
        label: `Ending ${i + 1}`,
        options: endings.variants.map((variant, j) => variant.name ?? `variant ${j + 1}`),
      });
    });
  }

  if (raid.optionals?.orderSwap?.rng) {
    add({ key: "order-swap", label: "Order swap", options: ["normal", "swapped"] });
  }

  const sweep = raid.optionals?.divebombSweep;
  if (sweep?.rng) {
    add({ key: "divebomb-start", label: "Divebomb start", options: rangeLabels(sweep.events.length, "spot") });
    add({ key: "divebomb-direction", label: "Divebomb direction", options: ["clockwise", "counter-clockwise"] });
  }

  const eventSets = combinations?.eventSets;
  if (eventSets) {
    for (const [key, setConfig] of Object.entries(eventSets)) {
      if (setConfig.rng && setConfig.sets.length > 1) {
        add({ key: `event-set-${key}`, label: `Event set ${key}`, options: rangeLabels(setConfig.sets.length, "set") });
      }
    }
  }

  for (const event of raid.events) {
    if (event.type !== "hazard" || !event.blackHole) continue;
    add({ key: `black-hole-${event.id}-combo`, label: `${event.name} combo`, options: rangeLabels(event.blackHole.combos.length, "combo") });
    add({ key: `black-hole-${event.id}-rotation`, label: `${event.name} rotation`, options: ["0", "90", "180", "270"] });
  }

  return decisions;
}

export function validateRngConstraints(raid: RaidDef, value: unknown): RngConstraints | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const descriptions = new Map(describeDecisions(raid).map(description => [description.key, description.options.length]));
  const constraints: Record<string, number> = {};
  for (const [key, selection] of Object.entries(value)) {
    const optionCount = descriptions.get(key);
    if (optionCount === undefined || !Number.isInteger(selection) || (selection as number) < 0 || (selection as number) >= optionCount) return null;
    constraints[key] = selection as number;
  }

  const forcedEndings = Object.entries(constraints)
    .filter(([key]) => key.startsWith("ending-"))
    .map(([, selection]) => selection);
  if (new Set(forcedEndings).size !== forcedEndings.length) return null;
  return constraints;
}
