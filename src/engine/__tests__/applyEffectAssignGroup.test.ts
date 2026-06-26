import { expect, test } from "bun:test";

import { createWorld } from "../world";
import { baseRaid, byId, loadRaid, noMove, runTicks } from "./helpers";

const supportIds = ["mt", "ot", "h1", "h2"];
const dpsIds = ["r1", "r2", "m1", "m2"];
const allIds = [...supportIds, ...dpsIds];

const entropyShort = { name: "Entropy Short", kind: "debuff" as const, duration: 18, behavior: { kind: "none" as const } };
const entropyLong = { name: "Entropy Long", kind: "debuff" as const, duration: 45, behavior: { kind: "none" as const } };
const fluidShort = { name: "Dynamic Fluid Short", kind: "debuff" as const, duration: 18, behavior: { kind: "none" as const } };
const fluidLong = { name: "Dynamic Fluid Long", kind: "debuff" as const, duration: 45, behavior: { kind: "none" as const } };

function hasEffect(world: ReturnType<typeof createWorld>, playerId: string, effectName: string) {
  return byId(world, playerId).effects.some(effect => effect.name === effectName);
}

function holders(world: ReturnType<typeof createWorld>, ids: string[], effectName: string) {
  return ids.filter(id => hasEffect(world, id, effectName));
}

const raid = loadRaid({
  ...baseRaid,
  events: [
    {
      type: "apply_effect",
      time: 0,
      id: "ef-short-support",
      name: "EF Short",
      players: supportIds,
      count: 1,
      rng: true,
      assignGroup: "ef-debuffs",
      effectChoiceGroup: "ef-short-kind",
      applyEffectChoices: [entropyShort, fluidShort],
    },
    {
      type: "apply_effect",
      time: 0,
      id: "ef-short-dps",
      name: "EF Short",
      players: dpsIds,
      count: 1,
      rng: true,
      assignGroup: "ef-debuffs",
      effectChoiceGroup: "ef-short-kind",
      applyEffectChoices: [entropyShort, fluidShort],
    },
    {
      type: "apply_effect",
      time: 0,
      id: "ef-long-support",
      name: "EF Long",
      players: supportIds,
      count: 1,
      rng: true,
      assignGroup: "ef-debuffs",
      effectChoiceGroup: "ef-short-kind",
      effectChoiceComplement: true,
      applyEffectChoices: [entropyLong, fluidLong],
    },
    {
      type: "apply_effect",
      time: 0,
      id: "ef-long-dps",
      name: "EF Long",
      players: dpsIds,
      count: 1,
      rng: true,
      assignGroup: "ef-debuffs",
      effectChoiceGroup: "ef-short-kind",
      effectChoiceComplement: true,
      applyEffectChoices: [entropyLong, fluidLong],
    },
  ],
});

test("apply_effect linked choices assign one short and one long per role pool", () => {
  const seen = new Set<string>();

  for (let seed = 1; seed <= 40; seed++) {
    const world = runTicks(createWorld(raid, seed), noMove, 2);
    const entropyShortHolders = holders(world, allIds, "Entropy Short");
    const entropyLongHolders = holders(world, allIds, "Entropy Long");
    const fluidShortHolders = holders(world, allIds, "Dynamic Fluid Short");
    const fluidLongHolders = holders(world, allIds, "Dynamic Fluid Long");

    const supportShort = [...holders(world, supportIds, "Entropy Short"), ...holders(world, supportIds, "Dynamic Fluid Short")];
    const supportLong = [...holders(world, supportIds, "Entropy Long"), ...holders(world, supportIds, "Dynamic Fluid Long")];
    const dpsShort = [...holders(world, dpsIds, "Entropy Short"), ...holders(world, dpsIds, "Dynamic Fluid Short")];
    const dpsLong = [...holders(world, dpsIds, "Entropy Long"), ...holders(world, dpsIds, "Dynamic Fluid Long")];

    expect(supportShort).toHaveLength(1);
    expect(supportLong).toHaveLength(1);
    expect(dpsShort).toHaveLength(1);
    expect(dpsLong).toHaveLength(1);
    expect(supportShort[0]).not.toBe(supportLong[0]);
    expect(dpsShort[0]).not.toBe(dpsLong[0]);

    if (entropyShortHolders.length > 0) {
      expect(entropyShortHolders).toHaveLength(2);
      expect(fluidLongHolders).toHaveLength(2);
      expect(fluidShortHolders).toHaveLength(0);
      expect(entropyLongHolders).toHaveLength(0);
      seen.add("entropy-short");
    } else {
      expect(fluidShortHolders).toHaveLength(2);
      expect(entropyLongHolders).toHaveLength(2);
      expect(entropyShortHolders).toHaveLength(0);
      expect(fluidLongHolders).toHaveLength(0);
      seen.add("fluid-short");
    }
  }

  expect(seen).toEqual(new Set(["entropy-short", "fluid-short"]));
});
