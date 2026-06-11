import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { loadRaid as loadRaidRaw } from "../raidLoader";
import { TANK_HP } from "./constants";
import { baseRaid, effect, human, loadRaid, noMove, roster, runTicks, withEffect, withPlayerEffect } from "./helpers";
import type { Vec } from "./helpers";

// --- RNG group mechanics -------------------------------------------------

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
  expect(m1.hp).toBe(100);
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
  expect(h1.hp).toBe(100);
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
  expect(coneAfter.players.find(p => p.id === "m1")!.hp).toBe(100);
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

test("a successful stack splits the damage among soakers in the radius", () => {
  // mt is marked; ot and h1 stand close (3 soakers), the rest stay well outside the radius.
  const raid = groupRaid([{
    type: "group", t: 0, name: "Stack", groups: [["mt"]],
    telegraph: 1, radius: 6, requiredCount: 3, damage: 90, damageType: "magical",
  }], {
    mt: { spawn: [0, 0] }, ot: { spawn: [3, 0] }, h1: { spawn: [0, 3] },
    h2: { spawn: [12, 0] }, r1: { spawn: [-12, 0] }, r2: { spawn: [0, -12] },
    m1: { spawn: [0, 12] }, m2: { spawn: [10, 10] },
  });
  const w = runTicks(createWorld(raid), noMove, Math.ceil(1.1 * 60));
  const hp = (id: string) => w.players.find(p => p.id === id)!.hp;
  // 3 soakers >= requiredCount -> 90/3 = 30 each; everyone else untouched.
  expect(hp("mt")).toBeCloseTo(TANK_HP - 30); // tank, split 90/3
  expect(hp("ot")).toBeCloseTo(TANK_HP - 30);
  expect(hp("h1")).toBeCloseTo(70);
  expect(hp("h2")).toBe(100);
  expect(hp("r1")).toBe(100);
});

test("an under-soaked stack fails: each soaker eats the full damage", () => {
  // requiredCount 4 but only mt + ot stack -> failure, full (unsplit) damage each.
  const raid = groupRaid([{
    type: "group", t: 0, name: "Stack", groups: [["mt"]],
    telegraph: 1, radius: 6, requiredCount: 4, damage: 50, damageType: "magical",
  }], {
    mt: { spawn: [0, 0] }, ot: { spawn: [3, 0] },
    h1: { spawn: [12, 0] }, h2: { spawn: [-12, 0] }, r1: { spawn: [0, 12] },
    r2: { spawn: [0, -12] }, m1: { spawn: [10, 10] }, m2: { spawn: [-10, -10] },
  });
  const w = runTicks(createWorld(raid), noMove, Math.ceil(1.1 * 60));
  const hp = (id: string) => w.players.find(p => p.id === id)!.hp;
  expect(hp("mt")).toBeCloseTo(TANK_HP - 50); // full 50 each, not split
  expect(hp("ot")).toBeCloseTo(TANK_HP - 50);
  expect(hp("h1")).toBe(100);
});

test("a lone marked player takes the full hit and consumes vuln", () => {
  // Default clock spots are >6 apart, so m1 (marked) stacks alone with requiredCount 1.
  const raid = groupRaid([{
    type: "group", t: 0, name: "Stack", groups: [["m1"]],
    telegraph: 1, radius: 6, damage: 30, damageType: "magical",
  }]);
  const world = withEffect(createWorld(raid), effect({
    behavior: { kind: "vuln", damageType: "magical", multiplier: 2 },
  }));
  const w = runTicks(world, noMove, Math.ceil(1.1 * 60));
  const p = human(w);
  expect(p.hp).toBeCloseTo(40); // 30 (lone soaker) * 2 vuln = 60 damage
  expect(p.effects.some(e => e.behavior.kind === "vuln")).toBe(false); // consumed
});

test("group marks a member of the chosen group", () => {
  const raid = groupRaid([{
    type: "group", t: 0, name: "Stack", groups: [["mt", "ot"]],
    telegraph: 2, radius: 6, damage: 100, damageType: "magical",
  }]);
  // Mid-cast (promoted, not yet resolved): one active group mechanic carrying the marker.
  const w = runTicks(createWorld(raid), noMove, 6);
  expect(w.groupMechanics).toHaveLength(1);
  const gm = w.groupMechanics[0];
  expect(["mt", "ot"]).toContain(gm.markedPlayerId);
  expect(gm.radius).toBe(6);
});

test("linked group event takes the complementary group", () => {
  const raid = groupRaid([
    { type: "group", id: "a", t: 0, name: "First", rng: true,
      groups: [["mt"], ["h2"]], telegraph: 1, radius: 6, damage: 50, damageType: "magical" },
    { type: "group", link: "a", t: 3, name: "Second",
      groups: [["mt"], ["h2"]], telegraph: 1, radius: 6, damage: 50, damageType: "magical" },
  ]);
  const w = runTicks(createWorld(raid), noMove, Math.ceil(4.1 * 60));
  const firstIdx = w.groupChoices["a"];
  expect([0, 1]).toContain(firstIdx);
  expect(w.groupChoices["group-1"]).toBe(1 - firstIdx);
});

test("group rng eventually picks both groups", () => {
  const events = [{
    type: "group", t: 0, name: "Stack", rng: true,
    groups: [["mt"], ["h2"]], telegraph: 1, radius: 6, damage: 50, damageType: "magical",
  }];
  const picks = new Set<number>();
  for (let i = 0; i < 40; i++) {
    const w = tick(createWorld(groupRaid(events)), noMove, 1 / 60); // promote on first tick
    picks.add(w.groupChoices["group-0"]);
  }
  expect(picks).toEqual(new Set([0, 1]));
});

// Inverse ("?") events: shown shapes are the telegraph; when inverted the hidden shapes are lethal.
