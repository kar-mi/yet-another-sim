import { expect, test } from "bun:test";
import { join } from "path";
import { parseRaidFile } from "../../server/raidFileReader";
import { computeBotIntents } from "../botIntent";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import { tick } from "../sim";
import { createWorld } from "../world";

const RAIDS = join(import.meta.dir, "..", "..", "..", "raids", "dancing-mad-ultimate");
const DT = 1 / 60;

// Axis offsets injected onto each slot's -a cone by optionals.combinations.endings.
const LATITUDE_OFFSET = -1.5707963267948966;
const LONGITUDE_OFFSET = 0;

async function bowelsWorld(seed: number) {
  const raidObj = await parseRaidFile(join(RAIDS, "bowels-of-agony.yaml"));
  const botObj = await parseRaidFile(join(RAIDS, "bowels-of-agony-bots.yaml"));
  const raid = applyBotPatterns(loadRaid(raidObj), loadBotPatterns(botObj));
  return createWorld(raid, seed);
}

function pendingTiming(world: ReturnType<typeof createWorld>, id: string) {
  const event = world.pending.find(e => e.id === id);
  if (!event || !("telegraph" in event)) throw new Error(`missing timed pending event ${id}`);
  return { start: event.t, resolve: event.t + event.telegraph };
}

function visibleImplosionCasts(world: ReturnType<typeof createWorld>) {
  return world.pending.filter(e => e.id.includes("implosion") && e.showCastBar);
}

test("bowels implosions roll both axis orders and bots survive them", async () => {
  const orders = new Set<string>();

  for (let seed = 1; seed <= 40; seed++) {
    let world = await bowelsWorld(seed);

    // Slot timing is fixed (slot 1 resolves 66, slot 2 resolves 68); the axis assigned to each slot
    // is the seeded part. endings injects the axis offset + cast-bar name onto each slot's cone pair.
    const slot1 = pendingTiming(world, "implosion-1-a");
    const slot2 = pendingTiming(world, "implosion-2-a");
    expect(slot1.resolve).toBe(66);
    expect(slot2.resolve).toBe(68);
    expect(slot1.resolve).toBeLessThanOrEqual(slot2.start);

    const slot1Offset = world.endingOffsets?.["implosion-1-a"];
    const latitudeFirst = slot1Offset === LATITUDE_OFFSET;
    expect(latitudeFirst || slot1Offset === LONGITUDE_OFFSET).toBe(true);
    // The two slots carry opposite axes.
    expect(world.endingOffsets?.["implosion-2-a"]).toBe(latitudeFirst ? LONGITUDE_OFFSET : LATITUDE_OFFSET);
    orders.add(latitudeFirst ? "latitude-first" : "longitude-first");

    // The single visible cast is slot 1's -a cone, labeled with its injected axis name.
    const visibleCasts = visibleImplosionCasts(world);
    expect(visibleCasts.map(e => e.id)).toEqual(["implosion-1-a"]);
    expect(visibleCasts[0]!.t + visibleCasts[0]!.telegraph).toBe(66);
    expect(visibleCasts[0]!.name).toBe(latitudeFirst ? "Latitude Implosion" : "Longitude Implosion");

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
