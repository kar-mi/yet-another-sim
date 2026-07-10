import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { loadRaid as loadRaidRaw } from "../raidLoader";
import { DPS_HP, HEALER_HP, TANK_HP } from "./constants";
import { baseRaid, effect, loadRaid, noMove, roster, runTicks, withPlayerEffect } from "./helpers";
import type { Vec } from "./helpers";

// Towers and effect_resolvers. Each raid is built with groupRaid: the shared roster at custom spawns
// plus the events under test.

function groupRaid(events: unknown[], over: Record<string, { spawn?: Vec }> = {}) {
  return loadRaid({ ...baseRaid, duration: 30, players: roster(over), events });
}


test("tower effect resolver triggers only valid inside carriers and removes their matching debuff", () => {
  const raid = groupRaid([
    {
      type: "effect_resolver", id: "spread-resolve", name: "Spread Resolve", effectName: "Spread Charge",
      action: { kind: "spread", radius: 2, damage: 10, damageType: "true" },
    },
    {
      type: "tower", id: "tower", t: 0, name: "Tower", telegraph: 0.5, pos: [0, 0], radius: 3,
      requiredCount: 2, failureDamage: 0, failureDamageType: "true", resolveEventIds: ["spread-resolve"],
    },
  ], {
    mt: { spawn: [0, 0] }, h1: { spawn: [1, 0] }, m1: { spawn: [10, 0] },
    ot: { spawn: [12, 0] }, h2: { spawn: [-12, 0] }, r1: { spawn: [0, 12] }, r2: { spawn: [0, -12] }, m2: { spawn: [10, 10] },
  });
  let world = createWorld(raid);
  world = withPlayerEffect(world, "mt", effect({ name: "Spread Charge" }));
  world = withPlayerEffect(world, "m1", effect({ name: "Spread Charge" }));

  const w = runTicks(world, noMove, Math.ceil(0.6 * 60));
  const mt = w.players.find(p => p.id === "mt")!;
  const h1 = w.players.find(p => p.id === "h1")!;
  const m1 = w.players.find(p => p.id === "m1")!;
  expect(mt.effects.some(e => e.name === "Spread Charge")).toBe(false);
  expect(m1.effects.some(e => e.name === "Spread Charge")).toBe(true);
  expect(mt.hp).toBe(TANK_HP - 10);
  expect(h1.hp).toBe(90);
  expect(m1.hp).toBe(DPS_HP);
});

test("tower effect resolver still triggers valid carriers when the tower fails", () => {
  const raid = groupRaid([
    {
      type: "effect_resolver", id: "spread-resolve", name: "Spread Resolve", effectName: "Spread Charge",
      action: { kind: "spread", radius: 2, damage: 10, damageType: "true" },
    },
    {
      type: "tower", id: "tower", t: 0, name: "Tower", telegraph: 0.5, pos: [0, 0], radius: 3,
      requiredCount: 2, failureDamage: 5, failureDamageType: "true", resolveEventIds: ["spread-resolve"],
    },
  ], {
    mt: { spawn: [0, 0] }, h1: { spawn: [10, 0] }, m1: { spawn: [12, 0] },
    ot: { spawn: [-12, 0] }, h2: { spawn: [0, 12] }, r1: { spawn: [0, -12] }, r2: { spawn: [10, 10] }, m2: { spawn: [-10, -10] },
  });
  let world = createWorld(raid);
  world = withPlayerEffect(world, "mt", effect({ name: "Spread Charge" }));
  world = withPlayerEffect(world, "m1", effect({ name: "Spread Charge" }));

  const w = runTicks(world, noMove, Math.ceil(0.6 * 60));
  const mt = w.players.find(p => p.id === "mt")!;
  const h1 = w.players.find(p => p.id === "h1")!;
  const m1 = w.players.find(p => p.id === "m1")!;
  expect(mt.effects.some(e => e.name === "Spread Charge")).toBe(false);
  expect(m1.effects.some(e => e.name === "Spread Charge")).toBe(true);
  expect(mt.hp).toBe(TANK_HP - 15);
  expect(h1.hp).toBe(95);
  expect(m1.hp).toBe(95);
});

test("under-soaked tower applies lethal failure damage to all players", () => {
  const raid = groupRaid([
    {
      type: "tower", id: "tower", t: 0, name: "Tower", telegraph: 0.5, pos: [0, 0], radius: 3,
      requiredCount: 2, failureDamage: 999999, failureDamageType: "true",
    },
  ], {
    mt: { spawn: [0, 0] }, h1: { spawn: [10, 0] }, m1: { spawn: [12, 0] },
    ot: { spawn: [-12, 0] }, h2: { spawn: [0, 12] }, r1: { spawn: [0, -12] }, r2: { spawn: [10, 10] }, m2: { spawn: [-10, -10] },
  });

  const world = runTicks(createWorld(raid), noMove, Math.ceil(0.6 * 60));

  expect(world.players.every(player => !player.alive)).toBe(true);
});

test("successful tower consumes one debuff stack but failed towers do not", () => {
  const tower = {
    type: "tower", id: "tower", t: 0, name: "Tower", telegraph: 0.5, pos: [0, 0], radius: 3,
    requiredCount: 2, failureDamage: 0, failureDamageType: "true", consumeEffect: { effectName: "Spells' Trouble", stacks: 1 },
  };
  const spawns = {
    mt: { spawn: [0, 0] as Vec }, h1: { spawn: [1, 0] as Vec }, m1: { spawn: [10, 0] as Vec },
    ot: { spawn: [12, 0] as Vec }, h2: { spawn: [-12, 0] as Vec }, r1: { spawn: [0, 12] as Vec }, r2: { spawn: [0, -12] as Vec }, m2: { spawn: [10, 10] as Vec },
  };
  const success = runTicks(withPlayerEffect(createWorld(groupRaid([tower], spawns)), "mt", effect({ name: "Spells' Trouble", stacks: 2 })), noMove, Math.ceil(0.6 * 60));
  expect(success.players.find(p => p.id === "mt")!.effects.find(e => e.name === "Spells' Trouble")?.stacks).toBe(1);

  const finalStack = runTicks(withPlayerEffect(createWorld(groupRaid([tower], spawns)), "mt", effect({ name: "Spells' Trouble", stacks: 1 })), noMove, Math.ceil(0.6 * 60));
  expect(finalStack.players.find(p => p.id === "mt")!.effects.some(e => e.name === "Spells' Trouble")).toBe(false);

  const failed = runTicks(withPlayerEffect(createWorld(groupRaid([tower], { ...spawns, h1: { spawn: [10, 0] } })), "mt", effect({ name: "Spells' Trouble", stacks: 2 })), noMove, Math.ceil(0.6 * 60));
  expect(failed.players.find(p => p.id === "mt")!.effects.find(e => e.name === "Spells' Trouble")?.stacks).toBe(2);
});

test("tower effect resolver ignores wrong-role players", () => {
  const raid = groupRaid([
    {
      type: "effect_resolver", id: "spread-resolve", name: "Spread Resolve", effectName: "Spread Charge",
      action: { kind: "spread", radius: 2, damage: 10, damageType: "true" },
    },
    {
      type: "tower", id: "tower", t: 0, name: "Healer Tower", telegraph: 0.5, pos: [0, 0], radius: 3,
      requiredCount: 1, requiredRoles: ["healer"], failureDamage: 0, failureDamageType: "true", resolveEventIds: ["spread-resolve"],
    },
  ], {
    mt: { spawn: [0, 0] }, h1: { spawn: [1, 0] }, m1: { spawn: [10, 0] },
    ot: { spawn: [12, 0] }, h2: { spawn: [-12, 0] }, r1: { spawn: [0, 12] }, r2: { spawn: [0, -12] }, m2: { spawn: [10, 10] },
  });
  const world = withPlayerEffect(createWorld(raid), "mt", effect({ name: "Spread Charge" }));

  const w = runTicks(world, noMove, Math.ceil(0.6 * 60));
  const mt = w.players.find(p => p.id === "mt")!;
  const h1 = w.players.find(p => p.id === "h1")!;
  expect(mt.effects.some(e => e.name === "Spread Charge")).toBe(true);
  expect(mt.hp).toBe(TANK_HP);
  expect(h1.hp).toBe(HEALER_HP);
});

test("tower effect resolver supports stack and cone actions", () => {
  const stackRaid = groupRaid([
    {
      type: "effect_resolver", id: "stack-resolve", name: "Stack Resolve", effectName: "Stack Charge",
      action: { kind: "stack", radius: 4, requiredCount: 2, damage: 40, damageType: "true" },
    },
    {
      type: "tower", id: "tower", t: 0, name: "Tower", telegraph: 0.5, pos: [0, 0], radius: 3,
      requiredCount: 1, failureDamage: 0, failureDamageType: "true", resolveEventIds: ["stack-resolve"],
    },
  ], {
    mt: { spawn: [0, 0] }, h1: { spawn: [1, 0] }, m1: { spawn: [10, 0] },
    ot: { spawn: [12, 0] }, h2: { spawn: [-12, 0] }, r1: { spawn: [0, 12] }, r2: { spawn: [0, -12] }, m2: { spawn: [10, 10] },
  });
  const stackWorld = withPlayerEffect(createWorld(stackRaid), "mt", effect({ name: "Stack Charge" }));
  const stackAfter = runTicks(stackWorld, noMove, Math.ceil(0.6 * 60));
  expect(stackAfter.players.find(p => p.id === "mt")!.hp).toBe(TANK_HP - 20);
  expect(stackAfter.players.find(p => p.id === "h1")!.hp).toBe(80);
  expect(stackAfter.players.find(p => p.id === "mt")!.effects.some(e => e.name === "Stack Charge")).toBe(false);

  const coneRaid = groupRaid([
    {
      type: "effect_resolver", id: "cone-resolve", name: "Cone Resolve", effectName: "Cone Charge",
      action: { kind: "cone_nearest", angleDeg: 60, length: 10, damage: 10, damageType: "true" },
    },
    {
      type: "tower", id: "tower", t: 0, name: "Tower", telegraph: 0.5, pos: [0, 0], radius: 3,
      requiredCount: 1, failureDamage: 0, failureDamageType: "true", resolveEventIds: ["cone-resolve"],
    },
  ], {
    mt: { spawn: [0, 0] }, h1: { spawn: [0, 5] }, r1: { spawn: [1, 8] }, m1: { spawn: [5, 0] },
    ot: { spawn: [12, 0] }, h2: { spawn: [-12, 0] }, r2: { spawn: [0, -12] }, m2: { spawn: [10, 10] },
  });
  const coneWorld = withPlayerEffect(createWorld(coneRaid), "mt", effect({ name: "Cone Charge" }));
  const coneAfter = runTicks(coneWorld, noMove, Math.ceil(0.6 * 60));
  expect(coneAfter.players.find(p => p.id === "mt")!.hp).toBe(TANK_HP);
  expect(coneAfter.players.find(p => p.id === "h1")!.hp).toBe(90);
  expect(coneAfter.players.find(p => p.id === "r1")!.hp).toBe(90);
  expect(coneAfter.players.find(p => p.id === "m1")!.hp).toBe(DPS_HP);
  expect(coneAfter.players.find(p => p.id === "mt")!.effects.some(e => e.name === "Cone Charge")).toBe(false);
});

test("tower effect resolver emits visible resolved aoe shapes", () => {
  const raid = groupRaid([
    {
      type: "effect_resolver", id: "spread-resolve", name: "Spread Resolve", effectName: "Spread Charge",
      action: { kind: "spread", radius: 2, damage: 10, damageType: "true" },
    },
    {
      type: "tower", id: "tower", t: 0, name: "Tower", telegraph: 0.5, pos: [0, 0], radius: 3,
      requiredCount: 1, failureDamage: 0, failureDamageType: "true", resolveEventIds: ["spread-resolve"],
    },
  ], {
    mt: { spawn: [0, 0] }, h1: { spawn: [10, 0] }, m1: { spawn: [12, 0] },
    ot: { spawn: [-12, 0] }, h2: { spawn: [0, 12] }, r1: { spawn: [0, -12] }, r2: { spawn: [10, 10] }, m2: { spawn: [-10, -10] },
  });
  let world = withPlayerEffect(createWorld(raid), "mt", effect({ name: "Spread Charge" }));
  world = runTicks(world, noMove, Math.ceil(0.6 * 60));

  const visual = world.active.find(m => m.id === "spread-resolve-mt-visual");
  expect(visual?.resolved).toBe(true);
  expect(visual?.showTelegraph).toBe(true);
  expect(visual?.shape).toEqual({ kind: "circle", center: { x: 0, z: 0 }, radius: 2 });

  world = runTicks(world, noMove, 5);
  expect(world.active.some(m => m.id === "spread-resolve-mt-visual")).toBe(true);
});

test("tower resolveEventIds must reference effect_resolver events", () => {
  expect(() => loadRaidRaw({
    ...baseRaid,
    events: [{
      type: "tower", id: "tower", t: 0, name: "Tower", telegraph: 1, pos: [0, 0], radius: 3,
      failureDamage: 0, failureDamageType: "true", resolveEventIds: ["missing"],
    }],
  })).toThrow(/unknown event id/);

  expect(() => loadRaidRaw({
    ...baseRaid,
    events: [
      { type: "heal", id: "heal", t: 0, name: "Heal" },
      {
        type: "tower", id: "tower", t: 0, name: "Tower", telegraph: 1, pos: [0, 0], radius: 3,
        failureDamage: 0, failureDamageType: "true", resolveEventIds: ["heal"],
      },
    ],
  })).toThrow(/must reference an effect_resolver event/);
});
