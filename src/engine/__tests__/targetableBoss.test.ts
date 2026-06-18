import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { loadRaid as loadRaidRaw } from "../raidLoader";
import { baseRaid, roster, runTicks } from "./helpers";

// ─── Schema ───────────────────────────────────────────────────────────────────

test("schema: targetable defaults to true when omitted (back-compat)", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [{ id: "chaos", pos: [0, 0] }],
    events: [],
  });
  expect(raid.bosses[0]!.targetable).toBe(true);
});

test("schema: targetable: false is accepted and preserved", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [
      { id: "chaos", pos: [0, 0] },
      { id: "kefka", pos: [0, 18], targetable: false },
    ],
    events: [],
  });
  expect(raid.bosses[0]!.targetable).toBe(true);
  expect(raid.bosses[1]!.targetable).toBe(false);
});

// ─── World creation ───────────────────────────────────────────────────────────

test("createWorld: non-targetable boss has empty threat and null currentTarget", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [
      { id: "chaos", pos: [0, 0] },
      { id: "kefka", pos: [0, 18], targetable: false },
    ],
    events: [],
  });
  const world = createWorld(raid);
  const kefka = world.bosses.find(b => b.id === "kefka")!;
  expect(Object.keys(kefka.threat)).toHaveLength(0);
  expect(kefka.currentTarget).toBeNull();
});

test("tick: non-targetable boss stays targetless and stationary while casting", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [
      { id: "chaos", pos: [0, 0] },
      { id: "kefka", pos: [0, 18], targetable: false },
    ],
    events: [{
      type: "aoe",
      id: "kefka-cast",
      t: 0,
      name: "Kefka Cast",
      telegraph: 5,
      damage: 0,
      damageType: "magical",
      bossId: "kefka",
      shape: { kind: "circle", center: [0, 0], radius: 20 },
    }],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(2 * 60));
  const kefka = world.bosses.find(b => b.id === "kefka")!;

  expect(kefka.currentTarget).toBeNull();
  expect(kefka.pos).toEqual({ x: 0, z: 18 });
});

test("createWorld: players default targetBossId to first targetable boss", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [
      { id: "chaos", pos: [0, 0] },
      { id: "kefka", pos: [0, 18], targetable: false },
    ],
    events: [],
  });
  const world = createWorld(raid);
  for (const player of world.players) {
    expect(player.targetBossId).toBe("chaos");
  }
});

test("createWorld: targetBossId skips non-targetable boss when it is listed first", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [
      { id: "kefka", pos: [0, 18], targetable: false },
      { id: "chaos", pos: [0, 0] },
    ],
    events: [],
  });
  const world = createWorld(raid);
  for (const player of world.players) {
    expect(player.targetBossId).toBe("chaos");
  }
});

// ─── cycleTarget ─────────────────────────────────────────────────────────────

test("cycleTarget: skips non-targetable boss, cycles only targetable bosses", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [
      { id: "chaos", pos: [-10, 0] },
      { id: "kefka", pos: [0, 18], targetable: false },
      { id: "exdeath", pos: [10, 0] },
    ],
    events: [],
  });
  const world = createWorld(raid);
  // Verify initial target is the first targetable boss.
  for (const player of world.players) {
    expect(player.targetBossId).toBe("chaos");
  }
  // One cycleTarget tick; confirm only chaos/exdeath cycle, never kefka.
  const intents = { mt: { move: { x: 0, z: 0 }, cycleTarget: true } };
  const w1 = tick(world, intents, 1 / 60);
  expect(w1.players.find(p => p.id === "mt")!.targetBossId).toBe("exdeath");

  const w2 = tick(w1, intents, 1 / 60);
  expect(w2.players.find(p => p.id === "mt")!.targetBossId).toBe("chaos");

  // Kefka should never appear as targetBossId across both cycles.
  expect(w1.players.find(p => p.id === "mt")!.targetBossId).not.toBe("kefka");
  expect(w2.players.find(p => p.id === "mt")!.targetBossId).not.toBe("kefka");
});
