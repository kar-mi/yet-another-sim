import { expect, test } from "bun:test";
import { join } from "path";
import { parseRaidFile } from "../../server/raidFileReader";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import { createWorld } from "../world";
import { computeBotIntents } from "../botIntent";
import { tick } from "../sim";
import { length } from "@shared/math";

const RAIDS = join(import.meta.dir, "..", "..", "..", "raids", "dancing-mad-ultimate");

async function bowlsWorld(seed: number) {
  const raidObj = await parseRaidFile(join(RAIDS, "bowls-of-agony.yaml"));
  const botObj = await parseRaidFile(join(RAIDS, "bowls-of-agony-bots.yaml"));
  const raid = applyBotPatterns(loadRaid(raidObj), loadBotPatterns(botObj));
  return createWorld(raid, seed);
}

test("the fired bowls limit cut carries an S/clockwise rotation basis", async () => {
  let w = await bowlsWorld(1);
  // Run just past the limit cut at t:91 so it fires into world.limitCuts.
  for (let i = 0; i < Math.ceil(92 * 60); i++) w = tick(w, computeBotIntents(w, 1 / 60), 1 / 60);
  const lc = w.limitCuts.find(l => l.id === "bowls-limit-cut");
  expect(lc).toBeDefined();
  expect(lc!.clockwise).toBe(true);
  expect(lc!.north.x).toBeCloseTo(0, 5);
  expect(lc!.north.z).toBeCloseTo(-1, 5);
});

test("bowls bots spread out to the limit-cut ring after t:94", async () => {
  let w = await bowlsWorld(1);
  const steps = Math.ceil(98 * 60);
  for (let i = 0; i < steps; i++) w = tick(w, computeBotIntents(w, 1 / 60), 1 / 60);

  const alive = w.players.filter(p => p.alive);
  expect(alive.length).toBeGreaterThan(0);
  // Each surviving bot should have a limit-cut number and be out near radius 18.
  for (const p of alive) {
    expect(p.effects.some(e => e.limitCutNumber !== undefined)).toBe(true);
    expect(length(p.pos)).toBeGreaterThan(14);
  }
});
