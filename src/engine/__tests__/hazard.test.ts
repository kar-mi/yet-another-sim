import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { selectOrbLayout, type BlackHoleOrb } from "../blackHoleOrbs";
import { baseRaid, byId, human, loadRaid, noMove, roster, runTicks } from "./helpers";
import type { World } from "@shared/types";

const blackHole = {
  name: "Black Hole",
  kind: "debuff" as const,
  duration: 0.5,
  behavior: { kind: "mitigation" as const, multiplier: 0.5 },
};

const blackHoleCombos: BlackHoleOrb[][] = [[
  { pos: { x: 0, z: 17 }, tether: true },
  { pos: { x: 17, z: 0 }, tether: true },
  { pos: { x: 0, z: -17 }, tether: true },
  { pos: { x: 5, z: 13 }, tether: false },
  { pos: { x: -7, z: 7 }, tether: false },
  { pos: { x: 7, z: 7 }, tether: false },
  { pos: { x: -13, z: 5 }, tether: false },
  { pos: { x: 13, z: -5 }, tether: false },
  { pos: { x: -7, z: -7 }, tether: false },
  { pos: { x: 6, z: -7 }, tether: false },
  { pos: { x: -6, z: -13 }, tether: false },
]];

function movePlayer(world: World, playerId: string, pos: { x: number; z: number }): World {
  return {
    ...world,
    players: world.players.map(player => player.id === playerId ? { ...player, pos } : player),
  };
}

test("hazard applies its debuff to players standing in explicit spots", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] }, m2: { spawn: [5, 0] } }),
    events: [{ type: "hazard", id: "black-hole", t: 0, name: "Black Hole", spots: [[0, 0]], radius: 1, duration: 2, applyEffect: blackHole }],
  });

  const world = runTicks(createWorld(raid), noMove, 1);

  expect(human(world).effects.some(effect => effect.id === "black-hole-m1")).toBe(true);
  expect(byId(world, "m2").effects.some(effect => effect.id === "black-hole-m2")).toBe(false);
});

test("hazard refreshes its debuff without stacking, then lets it decay after leaving", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] } }),
    events: [{ type: "hazard", id: "black-hole", t: 0, name: "Black Hole", spots: [[0, 0]], radius: 1, duration: 3, applyEffect: blackHole }],
  });

  const refreshed = runTicks(createWorld(raid), noMove, 60);
  const active = human(refreshed).effects.filter(effect => effect.id === "black-hole-m1");
  expect(active).toHaveLength(1);
  expect(active[0]!.appliedAt).toBeCloseTo(refreshed.time);

  const outside = movePlayer(refreshed, "m1", { x: 10, z: 0 });
  const decayed = runTicks(outside, noMove, 40);
  expect(human(decayed).effects.some(effect => effect.id === "black-hole-m1")).toBe(false);
});

test("hazard expires after its own duration", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [5, 0] } }),
    events: [{ type: "hazard", id: "black-hole", t: 0, name: "Black Hole", spots: [[0, 0]], radius: 1, duration: 1, applyEffect: blackHole }],
  });

  const armed = runTicks(createWorld(raid), noMove, 30);
  expect(armed.hazards).toHaveLength(1);
  expect(armed.pendingHazards).toHaveLength(0);

  const expired = runTicks(createWorld(raid), noMove, 80);
  expect(expired.hazards).toHaveLength(0);
});

test("blackHole hazards seed eleven deterministic spots", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ type: "hazard", id: "black-hole", t: 0, name: "Black Hole", blackHole: { combos: blackHoleCombos }, radius: 1, duration: 2, applyEffect: blackHole }],
  });

  const a = createWorld(raid, 123);
  const b = createWorld(raid, 123);

  expect(a.pendingHazards[0]!.spots).toHaveLength(11);
  expect(a.pendingHazards[0]!.spots).toEqual(b.pendingHazards[0]!.spots);
});

test("tether_source fromBlackHoleOrb resolves to a tether-flagged orb", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      { type: "hazard", id: "black-hole", t: 0, name: "Black Hole", blackHole: { combos: blackHoleCombos }, radius: 1, duration: 2, applyEffect: blackHole },
      {
        type: "tether_source", id: "orb-tether", t: 0, name: "Orb Tether",
        fromBlackHoleOrb: { hazardId: "black-hole", tetherIndex: 1 },
        finalizeAfter: 1, tetherKind: "debuff", buffName: "Unbecoming",
      },
    ],
  });

  const world = createWorld(raid, 123);
  const expected = selectOrbLayout(blackHoleCombos, 123).orbs.filter(orb => orb.tether)[1]!.pos;
  expect(world.pendingTethers[0]!.pos).toEqual(expected);
});

test("schema requires exactly one hazard spot source", () => {
  expect(() => loadRaid({
    ...baseRaid,
    events: [{ type: "hazard", id: "missing-spots", t: 0, name: "Black Hole", radius: 1, duration: 2, applyEffect: blackHole }],
  })).toThrow();

  expect(() => loadRaid({
    ...baseRaid,
    events: [{ type: "hazard", id: "both-spots", t: 0, name: "Black Hole", spots: [[0, 0]], blackHole: { combos: blackHoleCombos }, radius: 1, duration: 2, applyEffect: blackHole }],
  })).toThrow();
});
