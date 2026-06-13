import { expect, test } from "bun:test";
import { tick } from "../sim";
import { INITIAL_TANK_THREAT } from "@shared/constants";
import { createWorld } from "../world";
import { loadRaid as loadRaidRaw } from "../raidLoader";
import { TANK_HP } from "./constants";
import { HUMAN, baseRaid, human, loadRaid, runTicks } from "./helpers";

test("tick is deterministic", () => {
  const raid = loadRaid(baseRaid);
  const intents = { [HUMAN]: { move: { x: 0.3, z: 0.7 } } };

  let w1 = createWorld(raid, 1);
  let w2 = createWorld(raid, 1);
  for (let i = 0; i < 200; i++) {
    w1 = tick(w1, intents, 1 / 60);
    w2 = tick(w2, intents, 1 / 60);
  }

  expect(JSON.stringify(w1)).toBe(JSON.stringify(w2));
});

test("raid events require globally unique authored ids", () => {
  const event = {
    type: "aoe",
    id: "raidwide",
    t: 0,
    name: "Hit",
    telegraph: 0.1,
    damage: 1,
    damageType: "magical",
    shape: { kind: "circle", center: [0, 0], radius: 20 },
  };

  expect(() => loadRaidRaw({ ...baseRaid, events: [{ ...event, id: undefined }] })).toThrow(/Invalid raid data/);
  expect(() => loadRaidRaw({ ...baseRaid, events: [event, { ...event, t: 1 }] })).toThrow(/duplicate event id/);
});

test("heal event restores living players to max HP", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      { type: "aoe", t: 0, name: "Hit", telegraph: 0.1, damage: 30, damageType: "magical", shape: { kind: "circle", center: [0, 0], radius: 20 } },
      { type: "heal", t: 1, name: "Heal" },
    ],
  });

  let world = createWorld(raid);
  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, 12);
  expect(human(world).hp).toBeLessThan(human(world).maxHp);

  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, 60);
  expect(human(world).hp).toBe(human(world).maxHp);
  expect(world.players.find(p => p.id === "mt")!.hp).toBe(TANK_HP);
});


test("world includes a deterministic boss with a seeded threat table", () => {
  const raid = loadRaid(baseRaid);
  const world = createWorld(raid);

  expect(world.boss.id).toBe("boss");
  expect(world.boss.pos).toEqual({ x: 0, z: 0 });
  expect(world.boss.hp).toBe(1000);
  // Tanks are seeded; mt (lexicographically first tank) is the initial target.
  expect(world.boss.threat.mt).toBe(INITIAL_TANK_THREAT);
  expect(world.boss.threat.m1).toBe(0);
  expect(world.boss.currentTarget).toBe("mt");
  expect(world.boss.facing).toBe(0);
});

test("boss facing snaps to point at its current target each tick", () => {
  const raid = loadRaid(baseRaid);
  const world = createWorld(raid);
  const next = tick(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);

  const mt = next.players.find(p => p.id === "mt")!;
  expect(next.boss.facing).toBeCloseTo(Math.atan2(mt.pos.x - 0, mt.pos.z - 0));
  expect(next.boss.currentTarget).toBe("mt");
});


test("simultaneous mechanics with the same name get unique ids", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      { t: 3, name: "MirrorAOE", telegraph: 2, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [-5, 0], radius: 3 } },
      { t: 3, name: "MirrorAOE", telegraph: 2, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [5, 0], radius: 3 } },
    ],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(3.1 * 60));
  const ids = world.active.map(mechanic => mechanic.id);

  expect(world.active).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
});


test("status becomes wiped when lethal damage hits all players", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "OneShot", telegraph: 2, damage: 200, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 20 } }],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(5.1 * 60));
  expect(world.status).toBe("wiped");
});

test("status becomes cleared when all mechanics resolved and time elapsed", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "TestAOE", telegraph: 2, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 5 } }],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(11 * 60));
  expect(world.status).toBe("cleared");
});

test("status does not become cleared for an empty raid", () => {
  const raid = loadRaid(baseRaid);
  const world = runTicks(createWorld(raid), {}, Math.ceil(11 * 60));
  expect(world.hasMechanics).toBe(false);
  expect(world.status).toBe("running");
});

