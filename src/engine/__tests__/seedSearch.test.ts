import { expect, test } from "bun:test";
import { join } from "path";
import { parseRaidFile } from "../../server/raidFileReader";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import { preRollRaid } from "../preRoll";
import { createWorld } from "../world";
import { describeDecisions, findSeed } from "../seedSearch";
import { baseRaid, loadRaid as loadTestRaid } from "./helpers";

const RAIDS = join(import.meta.dir, "..", "..", "..", "raids", "dancing-mad-ultimate");

async function bowelsRaid() {
  const raidObj = await parseRaidFile(join(RAIDS, "bowels-of-agony.yaml"));
  const botObj = await parseRaidFile(join(RAIDS, "bowels-of-agony-bots.yaml"));
  return applyBotPatterns(loadRaid(raidObj), loadBotPatterns(botObj));
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

test("findSeed honors constraints and rejects impossible constraints", async () => {
  const raid = await bowelsRaid();
  const seed = findSeed(raid, { "divebomb-direction": 1 });

  expect(seed).not.toBeNull();
  expect(preRollRaid(raid, seed!).decisions["divebomb-direction"]).toBe(1);
  expect(findSeed(raid, { "divebomb-direction": 99 }, 50)).toBeNull();
});

test("describeDecisions lists bowels choices and empty raids have none", async () => {
  const keys = describeDecisions(await bowelsRaid()).map(decision => decision.key);

  expect(keys).toContain("divebomb-start");
  expect(keys).toContain("divebomb-direction");
  expect(describeDecisions(loadTestRaid(baseRaid))).toEqual([]);
});
