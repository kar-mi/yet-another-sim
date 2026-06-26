import { expect, test } from "bun:test";
import { join } from "path";
import { parseRaidFile } from "../../server/raidFileReader";
import { computeBotIntents } from "../botIntent";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import { tick } from "../sim";
import { createWorld } from "../world";

const RAIDS = join(import.meta.dir, "..", "..", "..", "raids", "dancing-mad-ultimate");
const DT = 1 / 60;

async function bowlsWorld(seed: number) {
  const raidObj = await parseRaidFile(join(RAIDS, "bowls-of-agony.yaml"));
  const botObj = await parseRaidFile(join(RAIDS, "bowls-of-agony-bots.yaml"));
  const raid = applyBotPatterns(loadRaid(raidObj), loadBotPatterns(botObj));
  return createWorld(raid, seed);
}

function pendingTiming(world: ReturnType<typeof createWorld>, id: string) {
  const event = world.pending.find(e => e.id === id);
  if (!event || !("telegraph" in event)) throw new Error(`missing timed pending event ${id}`);
  return { start: event.t, resolve: event.t + event.telegraph };
}

test("bowls implosions roll both staggered orders and bots survive them", async () => {
  const orders = new Set<string>();

  for (let seed = 1; seed <= 40; seed++) {
    let world = await bowlsWorld(seed);
    const latitude = pendingTiming(world, "latitude-implosion-left");
    const longitude = pendingTiming(world, "longitude-implosion-front");
    const latitudeFirst = latitude.resolve < longitude.resolve;
    orders.add(latitudeFirst ? "latitude-first" : "longitude-first");

    expect(latitudeFirst ? latitude.resolve : longitude.resolve).toBe(66);
    expect(latitudeFirst ? longitude.resolve : latitude.resolve).toBe(68);
    expect(latitudeFirst ? latitude.resolve : longitude.resolve).toBeLessThanOrEqual(latitudeFirst ? longitude.start : latitude.start);

    let lockedFacing: number | undefined;
    for (let i = 0; i < Math.ceil(69 * 60); i++) {
      world = tick(world, computeBotIntents(world, DT), DT);
      const chaos = world.bosses.find(b => b.id === "chaos")!;
      const hold = world.active.find(m => m.id === "implosion-facing-hold" && !m.resolved);
      if (hold && world.time < 68) {
        lockedFacing ??= chaos.facing;
        expect(chaos.facing).toBeCloseTo(lockedFacing, 8);
      }
    }

    const implosionHits = world.log.filter(entry =>
      entry.event === "hit" && (entry.mechanic === "Latitude Implosion" || entry.mechanic === "Longitude Implosion")
    );
    expect(implosionHits).toEqual([]);
  }

  expect(orders).toEqual(new Set(["latitude-first", "longitude-first"]));
});
