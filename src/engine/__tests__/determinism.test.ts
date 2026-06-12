import { expect, test } from "bun:test";
import { computeBotIntents } from "../botIntent";
import { tick } from "../sim";
import { createWorld } from "../world";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import { worldHash } from "../../shared/worldHash";
import type { RaidDef } from "../raidSchema";
import type { World } from "../../shared/types";

// Server-relayed lockstep requires that `tick` produce byte-identical worlds from the same seed +
// inputs on every client, and that the entire simulation state live in `World` (so a late joiner
// can resync by replaying). These tests exercise a full, mechanic-heavy fight (graven-image-3 with
// its bot patterns) driven purely by the seeded bot solver.

const DT = 1 / 60;
const SEED = 0x1234abcd;
const DIR = "raids/dancing-mad-ultimate";

async function gravenRaid(): Promise<RaidDef> {
  const raid = loadRaid(Bun.YAML.parse(await Bun.file(`${DIR}/graven-image-3.yaml`).text()));
  const bots = loadBotPatterns(Bun.YAML.parse(await Bun.file(`${DIR}/graven-image-3-bots.yaml`).text()));
  return applyBotPatterns(raid, bots);
}

// Run the fight to completion, hashing the world every 100 ticks. If `roundTripAt` is set, the world
// is serialized through JSON and rehydrated at that tick to prove no hidden state lives outside it.
function replay(raid: RaidDef, roundTripAt?: number): number[] {
  let w = createWorld(raid, SEED);
  const hashes: number[] = [];
  for (let i = 1; i <= 4000 && w.status === "running"; i++) {
    w = tick(w, computeBotIntents(w, DT), DT);
    if (roundTripAt === i) w = JSON.parse(JSON.stringify(w)) as World;
    if (i % 100 === 0) hashes.push(worldHash(w));
  }
  return hashes;
}

test("engine replay is bit-identical across runs (deterministic lockstep)", async () => {
  const raid = await gravenRaid();
  const a = replay(raid);
  expect(a.length).toBeGreaterThan(0);
  expect(replay(raid)).toEqual(a);
});

test("mid-run JSON round-trip leaves the simulation unchanged (state lives in World)", async () => {
  const raid = await gravenRaid();
  expect(replay(raid, 800)).toEqual(replay(raid));
});
