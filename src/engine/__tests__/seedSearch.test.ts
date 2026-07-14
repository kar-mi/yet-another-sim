import { expect, test } from "bun:test";
import { join } from "path";
import { parseRaidFile } from "../../server/raidFileReader";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import { preRollRaid } from "../preRoll";
import { createWorld } from "../world";
import { describeDecisions, validateRngConstraints } from "../seedSearch";
import { baseRaid, loadRaid as loadTestRaid } from "./helpers";

const RAIDS = join(import.meta.dir, "..", "..", "..", "raids", "dancing-mad-ultimate");

async function bowelsRaid() {
  const raidObj = await parseRaidFile(join(RAIDS, "bowels-of-agony.yaml"));
  const botObj = await parseRaidFile(join(RAIDS, "bowels-of-agony-bots.yaml"));
  return applyBotPatterns(loadRaid(raidObj), loadBotPatterns(botObj));
}

async function dmuRaid(name: string) {
  const raidObj = await parseRaidFile(join(RAIDS, `${name}.yaml`));
  return loadRaid(raidObj);
}

test("bowels divebomb decisions match the rolled sweep", async () => {
  const raid = await bowelsRaid();
  const order = raid.optionals!.divebombSweep!.events;
  const canonical = new Map(order.map(id => {
    const event = raid.events.find(e => e.id === id);
    if (!event || event.type !== "divebomb") throw new Error(id);
    return [id, event.from.join(",")];
  }));

  for (const seed of [1, 2, 3, 7, 42]) {
    const decisions = preRollRaid(raid, seed).decisions;
    const world = createWorld(raid, seed);
    const d1 = world.pendingDivebombs.find(d => d.id === "kefka-divebomb-1")!;
    const d2 = world.pendingDivebombs.find(d => d.id === "kefka-divebomb-2")!;
    const start = order.findIndex(id => canonical.get(id) === `${d1.from.x},${d1.from.z}`);
    const next = order.findIndex(id => canonical.get(id) === `${d2.from.x},${d2.from.z}`);

    expect(decisions["divebomb-start"]).toBe(start);
    expect(decisions["divebomb-direction"]).toBe(next === (start + 1) % order.length ? 0 : 1);
  }
});

test("constraints override outcomes without changing RNG progression", async () => {
  const raid = await bowelsRaid();
  const unconstrained = preRollRaid(raid, 123);
  const constrained = preRollRaid(raid, 123, { "divebomb-direction": 1 });

  expect(constrained.decisions["divebomb-direction"]).toBe(1);
  expect(constrained.rngState).toBe(unconstrained.rngState);
  expect(createWorld(raid, 123, { "divebomb-direction": 1 })).toEqual(createWorld(raid, 123, { "divebomb-direction": 1 }));
  expect(validateRngConstraints(raid, { "divebomb-direction": 1 })).toEqual({ "divebomb-direction": 1 });
  expect(validateRngConstraints(raid, { "divebomb-direction": 99 })).toBeNull();
  expect(validateRngConstraints(raid, { unknown: 0 })).toBeNull();
  expect(validateRngConstraints(raid, { "divebomb-direction": 0.5 })).toBeNull();
});

test("describeDecisions lists bowels choices and empty raids have none", async () => {
  const keys = describeDecisions(await bowelsRaid()).map(decision => decision.key);

  expect(keys).toContain("divebomb-start");
  expect(keys).toContain("divebomb-direction");
  expect(describeDecisions(loadTestRaid(baseRaid))).toEqual([]);
});

test("describeDecisions overlays raid-authored RNG labels", async () => {
  const decisions = describeDecisions(await bowelsRaid());
  const start = decisions.find(decision => decision.key === "divebomb-start");
  const direction = decisions.find(decision => decision.key === "divebomb-direction");

  expect(start).toEqual({
    key: "divebomb-start",
    label: "Dash 1 start",
    options: ["North", "Northwest", "West", "Southwest", "South", "Southeast", "East", "Northeast"],
  });
  expect(direction).toEqual({
    key: "divebomb-direction",
    label: "Dash direction",
    options: ["Counter-clockwise", "Clockwise"],
  });
});

test("describeDecisions ignores wrong-length authored options", () => {
  const raid = loadTestRaid({
    ...baseRaid,
    optionals: {
      towerRng: true,
      rngLabels: {
        "towers-offset": { label: "Tower start", options: ["bad"] },
      },
    },
  });

  expect(describeDecisions(raid).find(decision => decision.key === "towers-offset")).toEqual({
    key: "towers-offset",
    label: "Tower start",
    options: ["spot 1", "spot 2", "spot 3", "spot 4", "spot 5", "spot 6", "spot 7", "spot 8"],
  });
});

test("dancing mad rngLabels match described decisions", async () => {
  for (const name of ["bowels-of-agony", "black-hole", "forsaken", "graven-image-3", "kefka-says"]) {
    const raid = await dmuRaid(name);
    const decisions = new Map(describeDecisions(raid).map(decision => [decision.key, decision]));

    for (const [key, labels] of Object.entries(raid.optionals?.rngLabels ?? {})) {
      const decision = decisions.get(key);
      expect(decision, `${name} rngLabels.${key}`).toBeDefined();
      if (labels.options) {
        expect(labels.options, `${name} rngLabels.${key}.options`).toHaveLength(decision!.options.length);
      }
    }
  }
});

test("every advertised decision can be overridden without consuming different RNG", async () => {
  for (const name of ["bowels-of-agony", "black-hole", "forsaken", "graven-image-3", "kefka-says"]) {
    const raid = await dmuRaid(name);
    const baseline = preRollRaid(raid, 0x12345678);
    for (const decision of describeDecisions(raid)) {
      const value = decision.options.length - 1;
      const constrained = preRollRaid(raid, 0x12345678, { [decision.key]: value });
      expect(constrained.decisions[decision.key], `${name}:${decision.key}`).toBe(value);
      expect(constrained.rngState, `${name}:${decision.key}`).toBe(baseline.rngState);
    }
  }
});

test("one black hole can stay forced while another rerolls", async () => {
  const raid = await dmuRaid("black-hole");
  const comboKeys = describeDecisions(raid).map(decision => decision.key).filter(key => key.endsWith("-combo"));
  expect(comboKeys.length).toBeGreaterThanOrEqual(2);
  const [forcedKey, rngKey] = comboKeys;
  const rerolled = new Set<number>();
  for (let seed = 1; seed <= 64; seed++) {
    const decisions = preRollRaid(raid, seed, { [forcedKey!]: 0 }).decisions;
    expect(decisions[forcedKey!]).toBe(0);
    rerolled.add(decisions[rngKey!]!);
  }
  expect(rerolled.size).toBeGreaterThan(1);
});

test("forced shuffled endings must be unique", async () => {
  const raid = await dmuRaid("forsaken");
  const endingKeys = describeDecisions(raid).map(decision => decision.key).filter(key => key.startsWith("ending-"));
  expect(endingKeys.length).toBeGreaterThanOrEqual(2);
  expect(validateRngConstraints(raid, { [endingKeys[0]!]: 0, [endingKeys[1]!]: 0 })).toBeNull();
});
