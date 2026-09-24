import { expect, test } from "bun:test";
import { computeBotIntents } from "../bots/botIntent";
import { tick } from "../sim";
import { createWorld } from "../world";
import { DPS_HP, TANK_HP } from "./constants";
import type { World } from "@model/types";
import { HUMAN, baseRaid, loadRaid, roster, runTicks } from "./helpers";
import type { Vec } from "./helpers";

const spreadStackEvent = (over: Record<string, unknown> = {}) => ({
  type: "spread_stack" as const,
  id: "fire",
  t: 0.1,
  name: "Fire",
  telegraph: 0.1,
  shown: "spread" as const,
  damageType: "magical" as const,
  spread: { radius: 4, damage: 20 },
  stack: { groups: [["h1"]], radius: 6, requiredCount: 1, damage: 40 },
  ...over,
});

test("spread_stack: honest spread hits each player once alone, twice when overlapping", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({
      m1: { spawn: [0, 0] }, m2: { spawn: [1, 0] }, r1: { spawn: [15, 0] },
      mt: { spawn: [0, 15] }, ot: { spawn: [0, -15] }, h1: { spawn: [-15, 0] },
      h2: { spawn: [15, 15] }, r2: { spawn: [-15, -15] },
    }),
    events: [spreadStackEvent()],
  });
  const w = runTicks(createWorld(raid), {}, Math.ceil(0.3 * 60));
  const hp = (id: string) => w.players.find(p => p.id === id)!.hp;
  expect(hp("m1")).toBe(60);
  expect(hp("m2")).toBe(60);
  expect(hp("r1")).toBe(80);
  expect(hp("mt")).toBe(TANK_HP - 20);
});

test("spread_stack: honest stack splits the hit among soakers on the marked player", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({
      h1: { spawn: [0, 0] }, m1: { spawn: [2, 0] }, m2: { spawn: [0, 2] }, r1: { spawn: [15, 0] },
      mt: { spawn: [0, 15] }, ot: { spawn: [0, -15] }, h2: { spawn: [15, 15] }, r2: { spawn: [-15, -15] },
    }),
    events: [spreadStackEvent({ shown: "stack", stack: { groups: [["h1"]], radius: 6, requiredCount: 1, damage: 60 } })],
  });
  const w = runTicks(createWorld(raid), {}, Math.ceil(0.3 * 60));
  const hp = (id: string) => w.players.find(p => p.id === id)!.hp;
  expect(hp("h1")).toBe(80);
  expect(hp("m1")).toBe(80);
  expect(hp("m2")).toBe(80);
  expect(hp("r1")).toBe(DPS_HP);
});

test("spread_stack: stack marks one player per group (two groups -> two stacks)", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({
      m1: { spawn: [-8, 0] }, m2: { spawn: [-6, 0] },
      h1: { spawn: [8, 0] }, h2: { spawn: [6, 0] },
      mt: { spawn: [0, 15] }, ot: { spawn: [0, -15] }, r1: { spawn: [15, 15] }, r2: { spawn: [-15, -15] },
    }),
    events: [spreadStackEvent({ shown: "stack", stack: { groups: [["m1"], ["h1"]], radius: 6, requiredCount: 2, damage: 80 } })],
  });
  const w = runTicks(createWorld(raid), {}, Math.ceil(0.3 * 60));
  const hp = (id: string) => w.players.find(p => p.id === id)!.hp;
  expect(w.spreadStacks[0].markedPlayerIds.sort()).toEqual(["h1", "m1"]);
  expect(hp("m1")).toBe(60);
  expect(hp("m2")).toBe(60);
  expect(hp("h1")).toBe(60);
  expect(hp("h2")).toBe(60);
  expect(hp("mt")).toBe(TANK_HP);
  expect(hp("r1")).toBe(DPS_HP);
});

test("spread_stack: a '?' flips a shown spread into a stack", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({
      h1: { spawn: [0, 0] }, m1: { spawn: [2, 0] }, r1: { spawn: [15, 0] },
      mt: { spawn: [0, 15] }, ot: { spawn: [0, -15] }, h2: { spawn: [-15, 0] },
      r2: { spawn: [15, 15] }, m2: { spawn: [-15, -15] },
    }),
    events: [spreadStackEvent({ questionMark: true, spread: { radius: 4, damage: 50 }, stack: { groups: [["h1"]], radius: 6, requiredCount: 1, damage: 40 } })],
  });
  const w = runTicks(createWorld(raid), {}, Math.ceil(0.3 * 60));
  const hp = (id: string) => w.players.find(p => p.id === id)!.hp;
  expect(w.spreadStacks[0].inverted).toBe(true);
  expect(hp("r1")).toBe(DPS_HP);
  expect(hp("h1")).toBe(80);
  expect(hp("m1")).toBe(80);
});

test("spread_stack rng eventually picks both honest and flipped", () => {
  const raid = {
    ...baseRaid,
    events: [spreadStackEvent({ t: 0, telegraph: 1, rng: true })],
  };
  const seen = new Set<boolean>();
  for (let i = 0; i < 40; i++) {
    const w = tick(createWorld(loadRaid(raid)), {}, 1 / 60);
    seen.add(w.spreadStacks[0].inverted);
  }
  expect(seen).toEqual(new Set([true, false]));
});

test("spread_stack shown:random eventually displays both spread and stack", () => {
  const raid = {
    ...baseRaid,
    events: [spreadStackEvent({ t: 0, telegraph: 1, shown: "random" })],
  };
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const w = tick(createWorld(loadRaid(raid)), {}, 1 / 60);
    seen.add(w.spreadStacks[0].shown);
  }
  expect(seen).toEqual(new Set(["spread", "stack"]));
});

test("spread_stack solver sends bots to the spot for the actual mode", () => {
  const botSolvers = { generic: [
    { when: { mechanic: "fire.spread" }, spots: { mt: { x: -10, z: 0 } } },
    { when: { mechanic: "fire.stack" }, spots: { mt: { x: 10, z: 0 } } },
  ] };
  const mkWorld = (over: Record<string, unknown>) => {
    const raid = loadRaid({
      ...baseRaid,
      players: roster({ mt: { spawn: [0, 0] } }),
      events: [spreadStackEvent({ t: 0, telegraph: 5, ...over })],
      botSolvers,
    });
    return tick(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);
  };
  const mtMove = (w: World) => computeBotIntents(w, 1 / 60).mt.move.x;
  expect(mtMove(mkWorld({ shown: "stack" }))).toBeGreaterThan(0);
  expect(mtMove(mkWorld({ shown: "spread" }))).toBeLessThan(0);
  expect(mtMove(mkWorld({ shown: "spread", questionMark: true }))).toBeGreaterThan(0);
});

test("spread_stack solver picks spread spots by the active lightning orientation", () => {
  const botSolvers = { generic: [
    { when: { mechanic: ["fire.spread", "lightning.shown.a"] }, spots: { mt: { x: -10, z: 0 } } },
    { when: { mechanic: ["fire.spread", "lightning.inverted.a"] }, spots: { mt: { x: 10, z: 0 } } },
  ] };
  const mk = (lightningInverted: boolean) => {
    const raid = loadRaid({
      ...baseRaid,
      players: roster({ mt: { spawn: [0, 0] } }),
      events: [
        {
          type: "inverse", id: "lightning", t: 0, name: "Lightning", telegraph: 5,
          damage: 0, damageType: "magical", questionMark: lightningInverted,
          shownShapes: [{ kind: "circle", center: [50, 50], radius: 1 }],
          hiddenShapes: [{ kind: "circle", center: [50, 50], radius: 1 }],
        },
        spreadStackEvent({ t: 0, telegraph: 5, shown: "spread" }),
      ],
      botSolvers,
    });
    return tick(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);
  };
  expect(computeBotIntents(mk(false), 1 / 60).mt.move.x).toBeLessThan(0);
  expect(computeBotIntents(mk(true), 1 / 60).mt.move.x).toBeGreaterThan(0);
});

test("spread_stack solver picks variant-b spots when the lightning rolls orientation b", () => {
  const botSolvers = { generic: [
    { when: { mechanic: ["fire.spread", "lightning.shown.a"] }, spots: { mt: { x: -10, z: 0 } } },
    { when: { mechanic: ["fire.spread", "lightning.shown.b"] }, spots: { mt: { x: 0, z: -10 } } },
  ] };
  const mk = () => {
    const raid = loadRaid({
      ...baseRaid,
      players: roster({ mt: { spawn: [0, 0] } }),
      events: [
        {
          type: "inverse", id: "lightning", t: 0, name: "Lightning", telegraph: 5,
          damage: 0, damageType: "magical", variantRng: true,
          shownShapes: [{ kind: "circle", center: [50, 50], radius: 1 }],
          hiddenShapes: [{ kind: "circle", center: [50, 50], radius: 1 }],
          shownShapesB: [{ kind: "circle", center: [-50, -50], radius: 1 }],
          hiddenShapesB: [{ kind: "circle", center: [-50, -50], radius: 1 }],
        },
        spreadStackEvent({ t: 0, telegraph: 5, shown: "spread" }),
      ],
      botSolvers,
    });
    return tick(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);
  };
  const seen = { a: false, b: false };
  for (let i = 0; i < 60; i++) {
    const w = mk();
    const move = computeBotIntents(w, 1 / 60).mt.move!;
    if (w.inversions[0].variantB) {
      expect(move.z).toBeLessThan(0);
      expect(Math.abs(move.x)).toBeLessThan(0.01);
      seen.b = true;
    } else {
      expect(move.x).toBeLessThan(0);
      expect(Math.abs(move.z)).toBeLessThan(0.01);
      seen.a = true;
    }
  }
  expect(seen).toEqual({ a: true, b: true });
});

test("spread_stack solver picks stack spots by the active lightning orientation", () => {
  const botSolvers = { generic: [
    { when: { mechanic: ["fire.stack", "lightning.shown.a"] }, spots: { mt: { x: -10, z: 0 } } },
    { when: { mechanic: ["fire.stack", "lightning.inverted.a"] }, spots: { mt: { x: 10, z: 0 } } },
  ] };
  const mk = (lightningInverted: boolean) => {
    const raid = loadRaid({
      ...baseRaid,
      players: roster({ mt: { spawn: [0, 0] } }),
      events: [
        {
          type: "inverse", id: "lightning", t: 0, name: "Lightning", telegraph: 5,
          damage: 0, damageType: "magical", questionMark: lightningInverted,
          shownShapes: [{ kind: "circle", center: [50, 50], radius: 1 }],
          hiddenShapes: [{ kind: "circle", center: [50, 50], radius: 1 }],
        },
        spreadStackEvent({ t: 0, telegraph: 5, shown: "stack" }),
      ],
      botSolvers,
    });
    return tick(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);
  };
  expect(computeBotIntents(mk(false), 1 / 60).mt.move.x).toBeLessThan(0);
  expect(computeBotIntents(mk(true), 1 / 60).mt.move.x).toBeGreaterThan(0);
});
