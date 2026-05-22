import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { loadRaid } from "../raidLoader";
import type { Intents } from "../../shared/types";

const baseRaid = {
  name: "Test",
  arena: { zones: [{ kind: "circle" as const, center: [0, 0] as [number, number], radius: 20 }] },
  duration: 10,
  players: [{ id: "p1", role: "dps" as const, spawn: [0, 0] as [number, number] }],
  events: [] as {
    t: number;
    name: string;
    telegraph: number;
    damage: number;
    shape: { kind: "circle"; center: [number, number]; radius: number };
  }[],
};

function runTicks(world: ReturnType<typeof createWorld>, intents: Intents, count: number) {
  let w = world;
  for (let i = 0; i < count; i++) w = tick(w, intents, 1 / 60);
  return w;
}

test("tick is deterministic", () => {
  const raid = loadRaid(baseRaid);
  const intents = { p1: { move: { x: 0.3, z: 0.7 } } };

  let w1 = createWorld(raid);
  let w2 = createWorld(raid);
  for (let i = 0; i < 200; i++) {
    w1 = tick(w1, intents, 1 / 60);
    w2 = tick(w2, intents, 1 / 60);
  }

  expect(JSON.stringify(w1)).toBe(JSON.stringify(w2));
});

test("simultaneous mechanics with the same name get unique ids", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      { t: 3, name: "MirrorAOE", telegraph: 2, damage: 50, shape: { kind: "circle", center: [-5, 0], radius: 3 } },
      { t: 3, name: "MirrorAOE", telegraph: 2, damage: 50, shape: { kind: "circle", center: [5, 0], radius: 3 } },
    ],
  });
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 0 } } }, Math.ceil(3.1 * 60));
  const ids = world.active.map(mechanic => mechanic.id);

  expect(world.active).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
});

test("player takes damage when inside AOE at resolve", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "TestAOE", telegraph: 2, damage: 50, shape: { kind: "circle", center: [0, 0], radius: 10 } }],
    players: [{ id: "p1", role: "dps" as const, spawn: [0, 0] as [number, number] }],
  });
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 0 } } }, Math.ceil(5.1 * 60));
  expect(world.players[0].hp).toBeLessThan(100);
});

test("player survives when outside AOE at resolve", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "TestAOE", telegraph: 2, damage: 50, shape: { kind: "circle", center: [0, 0], radius: 5 } }],
    players: [{ id: "p1", role: "dps" as const, spawn: [0, 15] as [number, number] }],
  });
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 0 } } }, Math.ceil(5.1 * 60));
  expect(world.players[0].hp).toBe(100);
});

test("status becomes wiped when lethal damage hits all players", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "OneShot", telegraph: 2, damage: 100, shape: { kind: "circle", center: [0, 0], radius: 20 } }],
  });
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 0 } } }, Math.ceil(5.1 * 60));
  expect(world.status).toBe("wiped");
});

test("status becomes cleared when all mechanics resolved and time elapsed", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: [{ id: "p1", role: "dps" as const, spawn: [0, 15] as [number, number] }],
    events: [{ t: 3, name: "TestAOE", telegraph: 2, damage: 50, shape: { kind: "circle", center: [0, 0], radius: 5 } }],
  });
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 0 } } }, Math.ceil(11 * 60));
  expect(world.status).toBe("cleared");
});

test("player falls and dies when walking off arena", () => {
  const raid = loadRaid(baseRaid);
  // Move toward +Z edge (arena radius 20, player starts at [0,0])
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 1 } } }, Math.ceil(3 * 60));
  expect(world.players[0].alive).toBe(false);
  const fellEntries = world.log.filter(e => e.event === "fell");
  expect(fellEntries.length).toBeGreaterThan(0);
});

test("player jumps and lands back on the ground", () => {
  const raid = loadRaid(baseRaid);
  let world = createWorld(raid);

  world = tick(world, { p1: { move: { x: 0, z: 0 }, jump: true } }, 1 / 60);
  expect(world.players[0].y).toBeGreaterThan(0);
  expect(world.players[0].verticalVelocity).toBeGreaterThan(0);

  world = runTicks(world, { p1: { move: { x: 0, z: 0 } } }, 60);
  expect(world.players[0].y).toBe(0);
  expect(world.players[0].verticalVelocity).toBe(0);
});

test("jumping does not avoid ground-targeted mechanics", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 0.1, name: "GroundAOE", telegraph: 0.01, damage: 50, shape: { kind: "circle", center: [0, 0], radius: 10 } }],
  });
  let world = createWorld(raid);

  world = tick(world, { p1: { move: { x: 0, z: 0 }, jump: true } }, 1 / 60);
  world = runTicks(world, { p1: { move: { x: 0, z: 0 } } }, Math.ceil(0.2 * 60));

  expect(world.players[0].y).toBeGreaterThan(0);
  expect(world.players[0].hp).toBeLessThan(100);
});
