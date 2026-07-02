import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { DPS_HP, TANK_HP } from "./constants";
import { baseRaid, byId, loadRaid, noMove, roster, runTicks } from "./helpers";

function run(events: unknown[], players = roster()) {
  return runTicks(createWorld(loadRaid({ ...baseRaid, duration: 3, players, events })), noMove, Math.ceil(1 * 60));
}

test("laser tether beam hits players inside the rect and misses players outside", () => {
  const world = run([{
    type: "tether_source",
    t: 0,
    name: "Black Hole Laser",
    pos: [0, -18],
    finalizeAfter: 0.1,
    tetherKind: "debuff",
    buffName: "Laser Marker",
    applyTetherEffect: false,
    beam: { width: 2, length: 40, damage: 10, applyEffect: { ref: "unbecoming" } },
  }], roster({
    mt: { spawn: [0, -10] },
    h1: { spawn: [0, 0] },
    m1: { spawn: [3, 0] },
  }));

  expect(byId(world, "mt").hp).toBe(TANK_HP - 10);
  expect(byId(world, "h1").hp).toBe(90);
  expect(byId(world, "m1").hp).toBe(DPS_HP);
  expect(byId(world, "mt").effects.some(e => e.name === "Unbecoming")).toBe(true);
  expect(byId(world, "h1").effects.some(e => e.name === "Unbecoming")).toBe(true);
  expect(byId(world, "m1").effects.some(e => e.name === "Unbecoming")).toBe(false);
  expect(byId(world, "mt").effects.some(e => e.name === "Laser Marker")).toBe(false);
});

test("third laser on a Primordial Crust carrier leaves them at 1 HP and cleansed", () => {
  const world = run([
    { type: "apply_effect", t: 0, name: "Crust", players: ["m1"], applyEffect: { ref: "primordial_crust" } },
    ...[0.1, 0.3, 0.5].map((t, i) => ({
      type: "tether_source",
      id: `laser-${i}`,
      t,
      name: `Laser ${i + 1}`,
      pos: [0, -18],
      finalizeAfter: 0.05,
      tetherKind: "debuff",
      buffName: "Laser Marker",
      applyTetherEffect: false,
      beam: { width: 2, length: 40, damage: 10, pointing: [0, 1], applyEffect: { ref: "unbecoming" } },
    })),
  ], roster({ mt: { spawn: [0, -10] }, m1: { spawn: [0, 0] } }));

  expect(byId(world, "m1").alive).toBe(true);
  expect(byId(world, "m1").hp).toBe(1);
  expect(byId(world, "m1").effects.map(e => e.name)).toEqual([]);
});

test("persistent tether fires multiple lasers before despawning", () => {
  const world = run([{
    type: "tether_source",
    t: 0,
    name: "Repeating Laser",
    pos: [0, 0],
    finalizeAfter: 0.2,
    fireOffsets: [0.2, 0.4],
    despawnAfter: 0.6,
    tetherKind: "debuff",
    buffName: "Laser Marker",
    applyTetherEffect: false,
    beam: { width: 2, length: 40, damage: 10 },
  }], roster({
    mt: { spawn: [0, 4] },
    h1: { spawn: [5, 0] },
  }));

  expect(byId(world, "mt").hp).toBe(TANK_HP - 20);
  expect(byId(world, "h1").hp).toBe(100);
});

test("persistent tether retargets nearest player between fires", () => {
  const raid = loadRaid({
    ...baseRaid,
    duration: 2,
    players: roster({
      mt: { spawn: [0, 4] },
      h1: { spawn: [8, 0] },
    }),
    events: [{
      type: "tether_source",
      t: 0,
      name: "Swap Laser",
      pos: [0, 0],
      finalizeAfter: 0.2,
      fireOffsets: [0.2, 0.5],
      despawnAfter: 0.7,
      tetherKind: "debuff",
      buffName: "Laser Marker",
      applyTetherEffect: false,
      beam: { width: 2, length: 40, damage: 10 },
    }],
  });
  let world = runTicks(createWorld(raid), noMove, Math.ceil(0.3 * 60));
  world = {
    ...world,
    players: world.players.map(player =>
      player.id === "mt" ? { ...player, pos: { x: 8, z: 0 } }
      : player.id === "h1" ? { ...player, pos: { x: 0, z: 4 } }
      : player),
  };
  world = runTicks(world, noMove, Math.ceil(0.5 * 60));

  expect(byId(world, "mt").hp).toBe(TANK_HP - 10);
  expect(byId(world, "h1").hp).toBe(90);
});

test("black-hole tether sources are recorded as frame positions after rng resolution", async () => {
  const text = await Bun.file(`${import.meta.dir}/../../../raids/dancing-mad-ultimate/black-hole.yaml`).text();
  const raid = loadRaid(Bun.YAML.parse(text));
  const world = createWorld(raid, 1);

  expect(world.eventPositions["black-hole-2-laser-1"]).toBeDefined();
  expect(world.eventPositions["black-hole-2-laser-2"]).toBeDefined();
  expect(world.eventPositions["black-hole-2-laser-3"]).toBeDefined();
});

test("laser-tether demo raid loads without error", async () => {
  const text = await Bun.file(`${import.meta.dir}/../../../raids/debug/laser-tether-test.yaml`).text();
  const yaml = Bun.YAML.parse(text);
  expect(() => loadRaid(yaml)).not.toThrow();
});
