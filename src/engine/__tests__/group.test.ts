import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { DPS_HP, HEALER_HP, TANK_HP } from "./constants";
import { baseRaid, effect, human, loadRaid, noMove, roster, runTicks, withEffect } from "./helpers";
import type { Vec } from "./helpers";

// --- RNG group mechanics -------------------------------------------------

function groupRaid(events: unknown[], over: Record<string, { spawn?: Vec }> = {}) {
  return loadRaid({ ...baseRaid, duration: 30, players: roster(over), events });
}

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
  expect(hp("h2")).toBe(HEALER_HP);
  expect(hp("r1")).toBe(DPS_HP);
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
  expect(hp("h1")).toBe(HEALER_HP);
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
