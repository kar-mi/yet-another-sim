import { expect, test } from "bun:test";
import { genericSolverWaypoint, resolvedMechanics } from "../genericSolver";
import { computeBotIntents } from "../botIntent";
import { tick } from "../sim";
import { createWorld } from "../world";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import type { Player, World } from "../../shared/types";

// Minimal World/Player builders: the solver only reads a handful of fields, so we construct just
// those and cast, keeping each case readable.
function world(over: Record<string, unknown>): World {
  return {
    time: 0,
    groupChoices: {},
    active: [],
    towers: [],
    pendingTowers: [],
    inversions: [],
    spreadStacks: [],
    gazes: [],
    groupMechanics: [],
    players: [],
    botSolvers: undefined,
    ...over,
  } as unknown as World;
}

function player(over: Record<string, unknown>): Player {
  return { id: "p1", role: "dps", effects: [], ...over } as unknown as Player;
}

const ids = (w: World) => resolvedMechanics(w).map(m => m.resolvedId).sort();

test("plain aoe / tower / pending tower resolve to their bare ids", () => {
  const w = world({
    active: [{ id: "aoe-1", telegraphStart: 0, resolveAt: 5, resolved: false }],
    towers: [{ id: "tower-1", telegraphStart: 0, resolveAt: 5, resolved: false }],
    pendingTowers: [{ id: "tower-2", t: 8, telegraph: 3 }],
  });
  expect(ids(w)).toEqual(["aoe-1", "tower-1", "tower-2"]);
});

test("resolved aoes are skipped", () => {
  const w = world({ active: [{ id: "aoe-1", telegraphStart: 0, resolveAt: 5, resolved: true }] });
  expect(ids(w)).toEqual([]);
});

test("inverse resolves to shown/inverted x a/b", () => {
  const base = { telegraphStart: 0, resolveAt: 5, resolved: false };
  const w = world({
    inversions: [
      { id: "inv", inverted: false, variantB: false, ...base },
      { id: "inv", inverted: true, variantB: false, ...base },
      { id: "inv", inverted: false, variantB: true, ...base },
      { id: "inv", inverted: true, variantB: true, ...base },
    ],
  });
  expect(ids(w)).toEqual(["inv.inverted.a", "inv.inverted.b", "inv.shown.a", "inv.shown.b"]);
});

test("spread/stack resolves to the actual mode, flipped when inverted", () => {
  const base = { telegraphStart: 0, resolveAt: 5, resolved: false };
  const w = world({
    spreadStacks: [
      { id: "ss1", shown: "spread", inverted: false, ...base },
      { id: "ss2", shown: "spread", inverted: true, ...base },
      { id: "ss3", shown: "stack", inverted: true, ...base },
    ],
  });
  expect(ids(w)).toEqual(["ss1.spread", "ss2.stack", "ss3.spread"]);
});

test("gaze resolves to normal/reverse", () => {
  const base = { telegraphStart: 0, resolveAt: 5, resolved: false };
  const w = world({
    gazes: [
      { id: "g1", reverse: false, ...base },
      { id: "g2", reverse: true, ...base },
    ],
  });
  expect(ids(w)).toEqual(["g1.normal", "g2.reverse"]);
});

test("group mechanic resolves to .g<chosen index>", () => {
  const w = world({
    groupMechanics: [{ id: "stack-1", telegraphStart: 0, resolveAt: 5, resolved: false }],
    groupChoices: { "stack-1": 1 },
  });
  expect(ids(w)).toEqual(["stack-1.g1"]);
});

test("a rule's mechanic prefix-matches a longer resolved id", () => {
  const w = world({
    time: 2,
    inversions: [{ id: "lightning-1", inverted: true, variantB: true, telegraphStart: 0, resolveAt: 5, resolved: false }],
    botSolvers: { generic: [{ when: { mechanic: "lightning-1" }, spot: { x: 6, z: 6 } }] },
  });
  expect(genericSolverWaypoint(player({}), w)).toEqual({ x: 6, z: 6 });
});

test("a rule only matches the segment that it specifies", () => {
  const w = world({
    time: 2,
    inversions: [{ id: "lightning-1", inverted: false, variantB: false, telegraphStart: 0, resolveAt: 5, resolved: false }],
    botSolvers: { generic: [{ when: { mechanic: "lightning-1.inverted" }, spot: { x: 6, z: 6 } }] },
  });
  // shown.a does not start with inverted -> no match.
  expect(genericSolverWaypoint(player({}), w)).toBeUndefined();
});

test("first matching rule wins", () => {
  const w = world({
    time: 2,
    active: [{ id: "aoe-1", telegraphStart: 0, resolveAt: 5, resolved: false }],
    botSolvers: {
      generic: [
        { when: { mechanic: "aoe-1" }, spot: { x: 1, z: 1 } },
        { when: { mechanic: "aoe-1" }, spot: { x: 9, z: 9 } },
      ],
    },
  });
  expect(genericSolverWaypoint(player({}), w)).toEqual({ x: 1, z: 1 });
});

test("role condition gates the rule", () => {
  const w = world({
    time: 2,
    active: [{ id: "aoe-1", telegraphStart: 0, resolveAt: 5, resolved: false }],
    botSolvers: { generic: [{ when: { mechanic: "aoe-1", role: "tank" }, spot: { x: 1, z: 1 } }] },
  });
  expect(genericSolverWaypoint(player({ role: "dps" }), w)).toBeUndefined();
  expect(genericSolverWaypoint(player({ role: "tank" }), w)).toEqual({ x: 1, z: 1 });
});

test("debuff condition matches only while the named effect is active", () => {
  const w = world({
    time: 2,
    botSolvers: { generic: [{ when: { debuff: "Defamation" }, spot: { x: 1, z: 1 } }] },
  });
  const withDebuff = player({ effects: [{ name: "Defamation", appliedAt: 0, duration: 5 }] as Player["effects"] });
  const expired = player({ effects: [{ name: "Defamation", appliedAt: 0, duration: 1 }] as Player["effects"] });
  expect(genericSolverWaypoint(withDebuff, w)).toEqual({ x: 1, z: 1 });
  expect(genericSolverWaypoint(expired, w)).toBeUndefined();
  expect(genericSolverWaypoint(player({}), w)).toBeUndefined();
});

test("startAt/endAt clamp the activation window", () => {
  const make = (time: number) => world({
    time,
    active: [{ id: "aoe-1", telegraphStart: 0, resolveAt: 100, resolved: false }],
    botSolvers: { generic: [{ when: { mechanic: "aoe-1" }, startAt: 20, endAt: 30, spot: { x: 1, z: 1 } }] },
  });
  expect(genericSolverWaypoint(player({}), make(19))).toBeUndefined();
  expect(genericSolverWaypoint(player({}), make(25))).toEqual({ x: 1, z: 1 });
  expect(genericSolverWaypoint(player({}), make(31))).toBeUndefined();
});

test("spots[id] wins over the shared spot, and a missing entry falls through", () => {
  const w = world({
    time: 2,
    active: [{ id: "aoe-1", telegraphStart: 0, resolveAt: 5, resolved: false }],
    botSolvers: {
      generic: [
        { when: { mechanic: "aoe-1" }, spots: { p1: { x: 2, z: 2 } }, spot: { x: 0, z: 0 } },
      ],
    },
  });
  expect(genericSolverWaypoint(player({ id: "p1" }), w)).toEqual({ x: 2, z: 2 });
  // p2 has no spots entry but the rule supplies a shared spot.
  expect(genericSolverWaypoint(player({ id: "p2" }), w)).toEqual({ x: 0, z: 0 });
});

test("a rule with spots-only falls through to a later rule when this bot has no entry", () => {
  const w = world({
    time: 2,
    active: [{ id: "aoe-1", telegraphStart: 0, resolveAt: 5, resolved: false }],
    botSolvers: {
      generic: [
        { when: { mechanic: "aoe-1" }, spots: { p1: { x: 2, z: 2 } } },
        { when: { mechanic: "aoe-1" }, spot: { x: 9, z: 9 } },
      ],
    },
  });
  expect(genericSolverWaypoint(player({ id: "p2" }), w)).toEqual({ x: 9, z: 9 });
});

test("a rule is inactive outside the mechanic's telegraph window", () => {
  const make = (time: number) => world({
    time,
    active: [{ id: "aoe-1", telegraphStart: 10, resolveAt: 15, resolved: false }],
    botSolvers: { generic: [{ when: { mechanic: "aoe-1" }, spot: { x: 1, z: 1 } }] },
  });
  expect(genericSolverWaypoint(player({}), make(9))).toBeUndefined();
  expect(genericSolverWaypoint(player({}), make(12))).toEqual({ x: 1, z: 1 });
  expect(genericSolverWaypoint(player({}), make(16))).toBeUndefined();
});

test("generic solver rules load from a -bots companion and convert spots to Vec2", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/debug/rng-stack.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/debug/rng-stack-bots.yaml").text());
  const w = createWorld(applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData)), 1);

  expect(w.botSolvers?.generic).toHaveLength(6);
  expect(w.botSolvers?.generic?.[0]?.when).toEqual({ mechanic: "stack-1.g0", role: "tank" });
  expect(w.botSolvers?.generic?.[0]?.spot).toEqual({ x: -7, z: 7 });
  expect(w.botSolvers?.generic?.[2]?.spot).toEqual({ x: -4, z: 4 });
});

test("generic solver moves a bot toward the rolled group's stack spot", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/debug/rng-stack.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/debug/rng-stack-bots.yaml").text());
  let w = createWorld(applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData)), 1);

  // Advance until the first shared sentence (a group mechanic) is telegraphing.
  for (let i = 0; i < 600 && w.groupMechanics.length === 0; i++) {
    w = tick(w, computeBotIntents(w, 1 / 60), 1 / 60);
  }
  expect(w.groupMechanics.length).toBeGreaterThan(0);

  // ot (a bot tank) heads to its role-conditioned spot: g0 -> [-7, 7], g1 -> [7, -7].
  const intent = computeBotIntents(w, 1 / 60).ot;
  if (w.groupChoices["stack-1"] === 0) {
    expect(intent.move.x).toBeLessThan(0);
    expect(intent.move.z).toBeGreaterThan(0);
  } else {
    expect(intent.move.x).toBeGreaterThan(0);
    expect(intent.move.z).toBeLessThan(0);
  }
});
