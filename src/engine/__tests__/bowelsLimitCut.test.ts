import { expect, test } from "bun:test";
import { join } from "path";
import { parseRaidFile } from "../../server/raidFileReader";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import { createWorld } from "../world";
import { computeBotIntents } from "../botIntent";
import { tick } from "../sim";
import { length } from "@shared/math";

const RAIDS = join(import.meta.dir, "..", "..", "..", "raids", "dancing-mad-ultimate");

async function bowelsWorld(seed: number) {
  const raidObj = await parseRaidFile(join(RAIDS, "bowels-of-agony.yaml"));
  const botObj = await parseRaidFile(join(RAIDS, "bowels-of-agony-bots.yaml"));
  const raid = applyBotPatterns(loadRaid(raidObj), loadBotPatterns(botObj));
  return createWorld(raid, seed);
}

// The limit cut's placement basis is derived from the rolled divebomb sweep (no hardcoded rotation):
// relative-north = opposite dash #1's start, and the handedness tracks the sweep's spin direction.
test("the fired bowels limit cut derives its basis from the rolled dash sweep", async () => {
  for (const seed of [1, 2, 3, 7, 42]) {
    const w0 = await bowelsWorld(seed);
    // Capture the rolled starts of dash #1 and #2 before they fire (and linger out of the world).
    const d1 = w0.pendingDivebombs.find(d => d.id === "kefka-divebomb-1")!;
    const d2 = w0.pendingDivebombs.find(d => d.id === "kefka-divebomb-2")!;
    expect(d1 && d2).toBeTruthy();

    // Run just past the limit cut at t:91 so it fires into world.limitCuts.
    let w = w0;
    for (let i = 0; i < Math.ceil(92 * 60); i++) w = tick(w, computeBotIntents(w, 1 / 60), 1 / 60);
    const lc = w.limitCuts.find(l => l.id === "bowels-limit-cut");
    expect(lc).toBeDefined();

    // relative-north points opposite dash #1's start direction.
    const len = Math.hypot(d1.from.x, d1.from.z);
    expect(lc!.north.x).toBeCloseTo(-d1.from.x / len, 5);
    expect(lc!.north.z).toBeCloseTo(-d1.from.z / len, 5);

    // Handedness matches the sweep spin: a CCW step from dash #1 to #2 (positive cross) ⇒ clockwise.
    const cross = d1.from.x * d2.from.z - d1.from.z * d2.from.x;
    expect(lc!.clockwise).toBe(cross > 0);
  }
});

// Kefka rides onto the (seeded) origin of the first dash, then ducks under the map for the rest.
test("kefka teleports to the first dash start, then hides after the initial dash", async () => {
  for (const seed of [1, 4, 11]) {
    const w0 = await bowelsWorld(seed);
    const d1 = w0.pendingDivebombs.find(d => d.id === "kefka-divebomb-1")!;
    const kefka0 = w0.bosses.find(b => b.id === "kefka")!;
    expect(kefka0.hidden).toBe(false);

    let w = w0;
    // Just after the first dash fires (t:81): Kefka sits on its rolled start and is visible.
    for (let i = 0; i < Math.ceil(82 * 60); i++) w = tick(w, computeBotIntents(w, 1 / 60), 1 / 60);
    const kAfter1 = w.bosses.find(b => b.id === "kefka")!;
    expect(kAfter1.hidden).toBe(false);
    expect(kAfter1.pos.x).toBeCloseTo(d1.from.x, 5);
    expect(kAfter1.pos.z).toBeCloseTo(d1.from.z, 5);

    // After the second dash fires (t:83): Kefka is hidden for the remainder of the sweep.
    for (let i = 0; i < Math.ceil(2 * 60); i++) w = tick(w, computeBotIntents(w, 1 / 60), 1 / 60);
    expect(w.bosses.find(b => b.id === "kefka")!.hidden).toBe(true);
  }
});

// The seeded sweep must actually exercise its space: both spin directions and varied dash #1 starts.
test("the bowels dash sweep rolls both spin directions and multiple starts across seeds", async () => {
  const starts = new Set<string>();
  const clockwiseValues = new Set<boolean>();
  for (let seed = 1; seed <= 40; seed++) {
    const w = await bowelsWorld(seed);
    const d1 = w.pendingDivebombs.find(d => d.id === "kefka-divebomb-1")!;
    const d2 = w.pendingDivebombs.find(d => d.id === "kefka-divebomb-2")!;
    starts.add(`${d1.from.x},${d1.from.z}`);
    clockwiseValues.add(d1.from.x * d2.from.z - d1.from.z * d2.from.x > 0);
  }
  expect(starts.size).toBeGreaterThan(1);
  expect(clockwiseValues).toEqual(new Set([true, false]));
});

test("bowels bots spread out to the limit-cut ring after t:94", async () => {
  let w = await bowelsWorld(1);
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
