import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { DPS_HP } from "./constants";
import { baseRaid, effect, loadRaid, noMove, roster, runTicks, withPlayerEffect } from "./helpers";
import type { LogEntry, World } from "@model/types";
import type { Vec } from "./helpers";

function raidWith(events: unknown[], over: Record<string, { spawn?: Vec }> = {}, duration = 30) {
  return loadRaid({ ...baseRaid, duration, players: roster(over), events });
}

const hits = (world: World): LogEntry[] => world.log.filter(entry => entry.event === "avoidableHit");
const deaths = (world: World): LogEntry[] => world.log.filter(entry => entry.event === "death");

const stacked: Record<string, { spawn?: Vec }> = {
  mt: { spawn: [0, 0] }, ot: { spawn: [0, 0] }, h1: { spawn: [0, 0] }, h2: { spawn: [0, 0] },
  r1: { spawn: [0, 0] }, r2: { spawn: [0, 0] }, m1: { spawn: [0, 0] }, m2: { spawn: [0, 0] },
};

function centeredAoe(extra: Record<string, unknown> = {}): unknown {
  return {
    type: "aoe", id: "boom", t: 0, name: "Boom", telegraph: 0.5, damage: 10, damageType: "true",
    shape: { kind: "circle", center: [0, 0], radius: 5 }, ...extra,
  };
}

test("untagged damage records no avoidable hit", () => {
  const world = runTicks(createWorld(raidWith([centeredAoe()], stacked)), noMove, 40);
  expect(world.players.every(p => p.hp < p.maxHp)).toBe(true);
  expect(hits(world)).toEqual([]);
});

test("tagged damage records one hit per player with the HP it actually removed", () => {
  const world = runTicks(createWorld(raidWith([centeredAoe({ avoidable: true })], stacked)), noMove, 40);
  const recorded = hits(world);
  expect(recorded).toHaveLength(8);
  expect(recorded.every(entry => entry.source === "boom" && entry.mechanic === "Boom")).toBe(true);
  expect(recorded.every(entry => entry.hpLoss === 10)).toBe(true);
});

test("a tagged source that misses records nothing", () => {
  const world = runTicks(createWorld(raidWith([centeredAoe({ avoidable: true })])), noMove, 40);
  expect(world.players.every(p => p.hp === p.maxHp)).toBe(true);
  expect(hits(world)).toEqual([]);
});

test("an invincible player records a fully prevented hit rather than no hit", () => {
  let world = createWorld(raidWith([centeredAoe({ avoidable: true })], stacked));
  world = { ...world, players: world.players.map(p => p.id === "m1" ? { ...p, invincible: true } : p) };
  const after = runTicks(world, noMove, 40);
  const m1Hits = hits(after).filter(entry => entry.playerId === "m1");
  expect(m1Hits).toHaveLength(1);
  expect(m1Hits[0]!.hpLoss).toBe(0);
  expect(after.players.find(p => p.id === "m1")!.hp).toBe(DPS_HP);
});

test("a fully mitigated hit records zero HP loss", () => {
  let world = createWorld(raidWith([centeredAoe({ avoidable: true })], stacked));
  world = withPlayerEffect(world, "m1", effect({
    id: "immune", name: "Immunity", behavior: { kind: "mitigation", multiplier: 0.0000001 },
  }));
  const after = runTicks(world, noMove, 40);
  const m1Hits = hits(after).filter(entry => entry.playerId === "m1");
  expect(m1Hits).toHaveLength(1);
  expect(Math.round(m1Hits[0]!.hpLoss!)).toBe(0);
});

test("a tagged source checked against an already-dead player records nothing for them", () => {
  const lethal = { damage: 500, avoidable: true, shape: { kind: "circle", center: [0, 0], radius: 5 } };
  const world = runTicks(createWorld(raidWith([
    centeredAoe({ ...lethal, id: "first", t: 0 }),
    centeredAoe({ ...lethal, id: "second", t: 1 }),
  ], stacked)), noMove, 120);
  expect(hits(world).filter(entry => entry.source === "second")).toEqual([]);
  expect(deaths(world).filter(entry => entry.playerId === "m1")).toHaveLength(1);
});

test("mixed spread_stack components are tagged independently", () => {
  const world = runTicks(createWorld(raidWith([{
    type: "spread_stack", id: "ss", t: 0, name: "Split", telegraph: 0.5, shown: "spread",
    damageType: "true",
    spread: { radius: 6, damage: 5, avoidable: true },
    stack: { groups: [["mt"]], radius: 6, requiredCount: 2, damage: 5 },
  }], stacked)), noMove, 40);
  const recorded = hits(world);
  expect(recorded.length).toBeGreaterThan(0);
  expect(recorded.every(entry => entry.source === "ss:spread")).toBe(true);
});

test("an untagged spread_stack component records nothing while its sibling is tagged", () => {
  const world = runTicks(createWorld(raidWith([{
    type: "spread_stack", id: "ss", t: 0, name: "Split", telegraph: 0.5, shown: "stack",
    damageType: "true",
    spread: { radius: 6, damage: 5, avoidable: true },
    stack: { groups: [["mt"]], radius: 6, requiredCount: 2, damage: 5 },
  }], stacked)), noMove, 40);
  expect(hits(world)).toEqual([]);
});

test("status-effect damage is classified by the effect, and survives delayed resolution", () => {
  const world = runTicks(createWorld(raidWith([centeredAoe({
    damage: 0,
    applyEffect: {
      ref: "entropy", name: "Bomb", duration: 1, avoidable: true,
      behavior: { shape: "circle", radius: 6, damage: 7, damageType: "true" },
    },
  })], stacked)), noMove, 130);
  const recorded = hits(world);
  expect(recorded.length).toBeGreaterThan(0);
  expect(recorded.every(entry => entry.mechanic === "Bomb")).toBe(true);
  expect(recorded.every(entry => entry.hpLoss === 7)).toBe(true);
});

test("an untagged status effect records no hits", () => {
  const world = runTicks(createWorld(raidWith([centeredAoe({
    damage: 0,
    applyEffect: {
      ref: "entropy", name: "Bomb", duration: 1,
      behavior: { shape: "circle", radius: 6, damage: 7, damageType: "true" },
    },
  })], stacked)), noMove, 130);
  expect(hits(world)).toEqual([]);
});

test("an unavoidable lethal hit still records a death, with no hit alongside it", () => {
  const world = runTicks(createWorld(raidWith([centeredAoe({ damage: 500 })], stacked)), noMove, 40);
  expect(hits(world)).toEqual([]);
  expect(deaths(world)).toHaveLength(8);
  expect(deaths(world).every(entry => entry.source === "boom")).toBe(true);
});

test("a lethal avoidable hit records the hit and a linked death in the same tick", () => {
  const world = runTicks(createWorld(raidWith([centeredAoe({ damage: 500, avoidable: true })], stacked)), noMove, 40);
  const m1 = world.log.filter(entry => entry.playerId === "m1" && (entry.event === "avoidableHit" || entry.event === "death"));
  expect(m1.map(entry => entry.event)).toEqual(["avoidableHit", "death"]);
  expect(m1[0]!.source).toBe("boom");
  expect(m1[1]!.source).toBe("boom");
  expect(m1[0]!.t).toBe(m1[1]!.t);
});

test("simultaneous deaths are each recorded", () => {
  const world = runTicks(createWorld(raidWith([centeredAoe({ damage: 500, avoidable: true })], stacked)), noMove, 40);
  const recorded = deaths(world);
  expect(recorded).toHaveLength(8);
  expect(new Set(recorded.map(entry => entry.t)).size).toBe(1);
  expect(new Set(recorded.map(entry => entry.playerId)).size).toBe(8);
});

test("falling off the arena records a death outside the damage pipeline", () => {
  let world = createWorld(raidWith([], {}, 5));
  world = { ...world, players: world.players.map(p => p.id === "m1" ? { ...p, y: -100 } : p) };
  const after = runTicks(world, noMove, 2);
  const recorded = deaths(after).filter(entry => entry.playerId === "m1");
  expect(recorded).toHaveLength(1);
  expect(recorded[0]!.source).toBe("arena");
  expect(hits(after)).toEqual([]);
});

test("a revived player who dies again produces a second, separate death", () => {
  const lethal = { damage: 500, avoidable: true, shape: { kind: "circle", center: [0, 0], radius: 5 } };
  let world = createWorld(raidWith([
    centeredAoe({ ...lethal, id: "first", t: 0 }),
    centeredAoe({ ...lethal, id: "second", t: 2 }),
  ], stacked));

  const deathTicks: number[] = [];
  for (let i = 0; i < 200; i++) {
    world = { ...world, log: [] };
    world = runTicks(world, noMove, 1);
    for (const entry of deaths(world)) if (entry.playerId === "m1") deathTicks.push(i);
    if (i === 90) {
      world = { ...world, players: world.players.map(p => p.id === "m1" ? { ...p, alive: true, hp: p.maxHp } : p) };
    }
  }
  expect(deathTicks).toHaveLength(2);
});

test("a death is recorded once per transition, not repeated while dead", () => {
  let world = createWorld(raidWith([centeredAoe({ damage: 500, avoidable: true })], stacked));
  const perTick: number[] = [];
  for (let i = 0; i < 120; i++) {
    world = { ...world, log: [] };
    world = runTicks(world, noMove, 1);
    perTick.push(deaths(world).filter(entry => entry.playerId === "m1").length);
  }
  expect(perTick.reduce((a, b) => a + b, 0)).toBe(1);
});

test("createWorld bakes the tagged source keys and sorted sections into the world", () => {
  const world = createWorld(loadRaid({
    ...baseRaid,
    duration: 30,
    events: [
      centeredAoe({ id: "tagged", avoidable: true }),
      centeredAoe({ id: "untagged" }),
    ],
    sections: [
      { id: "late", name: "Late", t: 20 },
      { id: "early", name: "Early", t: 2 },
    ],
  }));
  expect(world.avoidableSources).toEqual({ tagged: true });
  expect(world.sections?.map(section => section.id)).toEqual(["early", "late"]);
});

test("recording entries are excluded from the world hash", async () => {
  const { worldHash } = await import("@model/worldHash");
  const world = runTicks(createWorld(raidWith([centeredAoe({ damage: 500, avoidable: true })], stacked)), noMove, 40);
  expect(world.log.length).toBeGreaterThan(0);
  expect(worldHash(world)).toBe(worldHash({ ...world, log: [] }));
});
