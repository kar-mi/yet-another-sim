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
      beam: { width: 2, length: 40, damage: 10, pointing: [0, 1], applyEffect: { ref: "unbecoming" } },
    })),
  ], roster({ mt: { spawn: [0, -10] }, m1: { spawn: [0, 0] } }));

  expect(byId(world, "m1").alive).toBe(true);
  expect(byId(world, "m1").hp).toBe(1);
  expect(byId(world, "m1").effects.map(e => e.name)).toEqual(["Mean"]);
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
    beam: { width: 2, length: 40, damage: 10 },
  }], roster({
    mt: { spawn: [0, 4] },
    h1: { spawn: [5, 0] },
  }));

  expect(byId(world, "mt").hp).toBe(TANK_HP - 20);
  expect(byId(world, "h1").hp).toBe(100);
});

test("persistent tether keeps hitting the same locked target across fires despite repositioning", () => {
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
      applyEffect: { ref: "debug_laser_marker" },
    }],
  });
  let world = runTicks(createWorld(raid), noMove, Math.ceil(0.3 * 60));
  // h1 moves much closer to the source than mt, but stays off the source->mt line - under the
  // old buggy logic this would steal the tether; under the fix, mt (never dead, never
  // intercepted) keeps it.
  world = {
    ...world,
    players: world.players.map(player =>
      player.id === "h1" ? { ...player, pos: { x: 3, z: 0 } } : player),
  };
  world = runTicks(world, noMove, Math.ceil(0.5 * 60));

  expect(world.log.filter(e => e.mechanic === "Laser Marker" && e.playerId === "mt" && e.event === "hit")).toHaveLength(2);
  expect(world.log.filter(e => e.mechanic === "Laser Marker" && e.playerId === "h1" && e.event === "hit")).toHaveLength(0);
});

test("single-shot tether keeps its target when a bystander gets closer without crossing the line", () => {
  const raid = loadRaid({
    ...baseRaid,
    duration: 1,
    players: roster({
      mt: { spawn: [0, 4] },
      h1: { spawn: [10, 0] },
    }),
    events: [{
      type: "tether_source",
      t: 0,
      name: "Sticky Chain",
      pos: [0, 0],
      finalizeAfter: 0.4,
      tetherKind: "debuff",
      buffName: "Sticky Chain",
      applyEffect: { ref: "debug_sticky_chain" },
    }],
  });
  let world = runTicks(createWorld(raid), noMove, Math.ceil(0.2 * 60));
  world = {
    ...world,
    players: world.players.map(player =>
      player.id === "h1" ? { ...player, pos: { x: 1.5, z: 0 } } : player),
  };
  world = runTicks(world, noMove, Math.ceil(0.3 * 60));

  expect(byId(world, "mt").effects.some(e => e.name === "Sticky Chain")).toBe(true);
  expect(byId(world, "h1").effects.some(e => e.name === "Sticky Chain")).toBe(false);
});

test("single-shot tether is stolen by a genuine line interceptor, not by whoever is merely closer", () => {
  const raid = loadRaid({
    ...baseRaid,
    duration: 1,
    players: roster({
      mt: { spawn: [0, 4] },
      h1: { spawn: [10, 0] },
      r1: { spawn: [-10, 0] },
    }),
    events: [{
      type: "tether_source",
      t: 0,
      name: "Line Steal",
      pos: [0, 0],
      finalizeAfter: 0.4,
      tetherKind: "debuff",
      buffName: "Line Steal",
      applyEffect: { ref: "debug_line_steal" },
    }],
  });
  let world = runTicks(createWorld(raid), noMove, Math.ceil(0.2 * 60));
  world = {
    ...world,
    players: world.players.map(player =>
      player.id === "h1" ? { ...player, pos: { x: 1, z: 0 } }
      : player.id === "r1" ? { ...player, pos: { x: 0, z: 2 } }
      : player),
  };
  world = runTicks(world, noMove, Math.ceil(0.3 * 60));

  expect(byId(world, "r1").effects.some(e => e.name === "Line Steal")).toBe(true);
  expect(byId(world, "mt").effects.some(e => e.name === "Line Steal")).toBe(false);
  expect(byId(world, "h1").effects.some(e => e.name === "Line Steal")).toBe(false);
});

test("persistent tether can be intercepted before a later fire", () => {
  const raid = loadRaid({
    ...baseRaid,
    duration: 2,
    players: roster({
      mt: { spawn: [0, 4] },
      h1: { spawn: [10, 0] },
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
      applyEffect: { ref: "debug_laser_marker" },
    }],
  });
  // First fire (t=0.2) hits mt normally.
  let world = runTicks(createWorld(raid), noMove, Math.ceil(0.3 * 60));
  // h1 walks onto the source->mt line ahead of the second scheduled fire (t=0.5).
  world = {
    ...world,
    players: world.players.map(player =>
      player.id === "h1" ? { ...player, pos: { x: 0, z: 2 } } : player),
  };
  world = runTicks(world, noMove, Math.ceil(0.5 * 60));

  expect(world.log.filter(e => e.mechanic === "Laser Marker" && e.playerId === "mt" && e.event === "hit")).toHaveLength(1);
  expect(world.log.filter(e => e.mechanic === "Laser Marker" && e.playerId === "h1" && e.event === "hit")).toHaveLength(1);
});

test("black-hole tether orbs are recorded after rng resolution", async () => {
  const text = await Bun.file(`${import.meta.dir}/../../../raids/dancing-mad-ultimate/black-hole.yaml`).text();
  const raid = loadRaid(Bun.YAML.parse(text));
  const world = createWorld(raid, 1);

  // Laser origins are no longer baked into eventPositions; the three physical tether orbs per hazard
  // are recorded on world.blackHoleTethers and resolved to clockwise slots at runtime.
  expect(world.blackHoleTethers["black-hole-2"]!.positions).toHaveLength(3);
});

test("laser-tether demo raid loads without error", async () => {
  const text = await Bun.file(`${import.meta.dir}/../../../raids/debug/laser-tether-test.yaml`).text();
  const yaml = Bun.YAML.parse(text);
  expect(() => loadRaid(yaml)).not.toThrow();
});
