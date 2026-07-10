import { expect, test } from "bun:test";
import { join } from "path";
import { parseRaidFile } from "../../server/raidFileReader";
import { loadRaid } from "../raidLoader";
import { preRollRaid } from "../preRoll";
import { createWorld } from "../world";
import { runTicks } from "./helpers";

const RAID_PATH = join(import.meta.dir, "..", "..", "..", "raids", "dancing-mad-ultimate", "kefka-says.yaml");

async function p4Raid() {
  return loadRaid(await parseRaidFile(RAID_PATH));
}

function seedFor(raid: Awaited<ReturnType<typeof p4Raid>>, key: string, value: number) {
  for (let seed = 1; seed < 200; seed++) {
    if (preRollRaid(raid, seed).decisions[key] === value) return seed;
  }
  throw new Error(`No seed for ${key}=${value}`);
}

test("Kefka Says selects one timing branch for Chaos and Grand Cross", async () => {
  const raid = await p4Raid();
  const chaosFirst = seedFor(raid, "event-set-chaos-order", 0);
  const infernoFirst = seedFor(raid, "event-set-chaos-order", 1);

  const tsunamiIds = new Set(preRollRaid(raid, chaosFirst).events.map(event => event.id));
  const infernoIds = new Set(preRollRaid(raid, infernoFirst).events.map(event => event.id));
  expect(tsunamiIds.has("tsunami-first")).toBe(true);
  expect(tsunamiIds.has("inferno-first")).toBe(false);
  expect(infernoIds.has("inferno-first")).toBe(true);
  expect(infernoIds.has("tsunami-first")).toBe(false);

  const durationBranches = new Set<number>();
  for (let seed = 1; seed < 50; seed++) durationBranches.add(preRollRaid(raid, seed).decisions["event-set-grand-cross-duration"]!);
  expect(durationBranches).toEqual(new Set([0, 1]));
});

test("Kefka Says snapshots eight Stray Flames and Stray Spray circles in either Chaos order", async () => {
  const raid = await p4Raid();
  const safeRaid = {
    ...raid,
    events: raid.events.filter(event => !event.id.includes("bomb") && event.id !== "death-surge"),
  };

  for (const chaosOrder of [0, 1]) {
    const seed = seedFor(raid, "event-set-chaos-order", chaosOrder);
    const flames = runTicks(createWorld(safeRaid, seed), {}, Math.ceil(92 * 60));
    expect(flames.active.filter(event => /Stray Flames/.test(event.name))).toHaveLength(8);

    const spray = runTicks(createWorld(safeRaid, seed), {}, Math.ceil(114.5 * 60));
    expect(spray.active.filter(event => /Stray Spray/.test(event.name))).toHaveLength(8);
  }
});

test("Kefka Says jumps Neo Exdeath to every cardinal and intercardinal", async () => {
  const raid = await p4Raid();
  const seen = new Set<string>();
  for (let seed = 1; seed <= 32; seed++) {
    const world = runTicks(createWorld(raid, seed), {}, Math.ceil(61.3 * 60));
    const exdeath = world.bosses.find(boss => boss.id === "exdeath")!;
    seen.add(`${exdeath.pos.x},${exdeath.pos.z}`);
    expect(Math.hypot(exdeath.pos.x, exdeath.pos.z)).toBeCloseTo(20, 5);
  }
  expect(seen.size).toBe(8);
});

test("Kefka Says keeps Chaos and Neo Exdeath stationary", async () => {
  const raid = await p4Raid();
  const beforeJump = runTicks(createWorld(raid, 1), {}, Math.ceil(60 * 60));
  const chaos = beforeJump.bosses.find(boss => boss.id === "chaos")!;
  const exdeath = beforeJump.bosses.find(boss => boss.id === "exdeath")!;
  expect(chaos.targetable).toBe(false);
  expect(exdeath.targetable).toBe(false);
  expect(chaos.pos).toEqual({ x: -12, z: 12 });
  expect(exdeath.pos).toEqual({ x: 12, z: 12 });

  const afterJump = runTicks(beforeJump, {}, Math.ceil(1.3 * 60));
  const exdeathPos = afterJump.bosses.find(boss => boss.id === "exdeath")!.pos;
  const later = runTicks(afterJump, {}, Math.ceil(1 * 60));
  expect(later.bosses.find(boss => boss.id === "exdeath")!.pos).toEqual(exdeathPos);
});
