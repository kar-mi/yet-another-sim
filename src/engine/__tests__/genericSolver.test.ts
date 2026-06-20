import { expect, test } from "bun:test";
import { genericSolverWaypoint, resolvedMechanics } from "../genericSolver";
import { computeBotIntents } from "../botIntent";
import { tick } from "../sim";
import { createWorld } from "../world";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import { baseRaid, roster } from "./helpers";
import type { Player, World } from "@shared/types";

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

test("a bot holds its solver position after the rule window ends", () => {
  const bot = player({
    alive: true,
    control: "bot",
    pos: { x: 0, z: 0 },
    pattern: [{ t: 0, pos: { x: 0, z: 0 } }],
  });
  const w = world({
    time: 5,
    players: [bot],
    active: [{ id: "aoe-1", telegraphStart: 0, resolveAt: 100, resolved: false }],
    botSolvers: {
      generic: [{ when: { mechanic: "aoe-1" }, endAt: 10, spot: { x: 10, z: 0 } }],
    },
  });

  expect(computeBotIntents(w, 1 / 60).p1?.move.x).toBeGreaterThan(0);
  expect(bot.botWaypointResumeAfter).toBe(5);

  w.time = 11;
  bot.pos = { x: 10, z: 0 };
  expect(computeBotIntents(w, 1 / 60).p1).toBeUndefined();
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

test("a mechanic matches a resolved mechanic by label", () => {
  const w = world({
    time: 2,
    active: [{ id: "close-bait-1", labels: ["bait-1"], telegraphStart: 0, resolveAt: 5, resolved: false }],
    botSolvers: { generic: [{ when: { mechanic: "bait-1" }, spot: { x: 6, z: 6 } }] },
  });
  expect(genericSolverWaypoint(player({}), w)).toEqual({ x: 6, z: 6 });
});

test("a debuff array requires every listed effect to be active", () => {
  const base = { time: 2, botSolvers: { generic: [{ when: { debuff: ["A", "B"] }, spot: { x: 1, z: 1 } }] } };
  const both = player({ effects: [{ name: "A", appliedAt: 0, duration: 5 }, { name: "B", appliedAt: 0, duration: 5 }] as Player["effects"] });
  const one = player({ effects: [{ name: "A", appliedAt: 0, duration: 5 }] as Player["effects"] });
  expect(genericSolverWaypoint(both, world(base))).toEqual({ x: 1, z: 1 });
  expect(genericSolverWaypoint(one, world(base))).toBeUndefined();
});

test("partnerDebuff checks the bot's partner via world.partners", () => {
  const p1 = player({ id: "p1", effects: [] });
  const p2 = player({ id: "p2", effects: [{ name: "Cone", appliedAt: 0, duration: 5 }] as Player["effects"] });
  const w = world({
    time: 2,
    players: [p1, p2],
    partners: { p1: "p2", p2: "p1" },
    botSolvers: { generic: [{ when: { partnerDebuff: "Cone" }, spot: { x: 1, z: 1 } }] },
  });
  expect(genericSolverWaypoint(p1, w)).toEqual({ x: 1, z: 1 }); // partner p2 has Cone
  expect(genericSolverWaypoint(p2, w)).toBeUndefined();         // partner p1 has nothing
});

test("soaks compares the bot's group to the matched mechanic's group", () => {
  const make = () => world({
    time: 2,
    towers: [{ id: "tower-1", group: "A", pos: { x: 0, z: 5 }, telegraphStart: 0, resolveAt: 5, resolved: false }],
    playerGroups: { soaker: "A", other: "B" },
    botSolvers: {
      generic: [
        { when: { mechanic: "tower-1", soaks: true }, spot: { x: 1, z: 1 } },
        { when: { mechanic: "tower-1", soaks: false }, spot: { x: 9, z: 9 } },
      ],
    },
  });
  expect(genericSolverWaypoint(player({ id: "soaker" }), make())).toEqual({ x: 1, z: 1 });
  expect(genericSolverWaypoint(player({ id: "other" }), make())).toEqual({ x: 9, z: 9 });
});

test("frame: matched rotates a spot into the matched towers' bisector frame", () => {
  // Two towers at [0,5] and [5,0]: north = bisector [0.707, 0.707]; a frame [0, 5] spot maps to 5*north.
  const w = world({
    time: 2,
    towers: [
      { id: "t-l", labels: ["wave"], pos: { x: 0, z: 5 }, telegraphStart: 0, resolveAt: 5, resolved: false },
      { id: "t-r", labels: ["wave"], pos: { x: 5, z: 0 }, telegraphStart: 0, resolveAt: 5, resolved: false },
    ],
    botSolvers: { generic: [{ when: { mechanic: "wave" }, frame: "matched", spot: { x: 0, z: 5 } }] },
  });
  const spot = genericSolverWaypoint(player({}), w)!;
  expect(spot.x).toBeCloseTo(3.5355, 3);
  expect(spot.z).toBeCloseTo(3.5355, 3);
});

test("frame: [eventIds] rotates using static event positions", () => {
  // Frame north from events at [0,-5] and [-5,0]: bisector [-0.707, -0.707]; spot [0, 5] -> 5*north.
  const w = world({
    time: 2,
    active: [{ id: "bait", telegraphStart: 0, resolveAt: 5, resolved: false }],
    eventPositions: { "ev-a": { x: 0, z: -5 }, "ev-b": { x: -5, z: 0 } },
    botSolvers: { generic: [{ when: { mechanic: "bait" }, frame: ["ev-a", "ev-b"], spot: { x: 0, z: 5 } }] },
  });
  const spot = genericSolverWaypoint(player({}), w)!;
  expect(spot.x).toBeCloseTo(-3.5355, 3);
  expect(spot.z).toBeCloseTo(-3.5355, 3);
});

test("frame: { crystal } rotates using the resolved crystal position", () => {
  const w = world({
    time: 2,
    active: [{ id: "bait", telegraphStart: 0, resolveAt: 5, resolved: false }],
    crystals: [{ id: "crystal-wind", element: "wind", pos: { x: 9, z: 9 }, spawnAt: 0 }],
    botSolvers: { generic: [{ when: { mechanic: "bait" }, frame: { crystal: "wind" }, spot: { x: 0, z: 5 } }] },
  });
  const spot = genericSolverWaypoint(player({}), w)!;
  expect(spot.x).toBeCloseTo(3.5355, 3);
  expect(spot.z).toBeCloseTo(3.5355, 3);
});

test("frame: { boss: { from: facing } } rotates using the primary boss facing", () => {
  const w = world({
    time: 2,
    active: [{ id: "bait", telegraphStart: 0, resolveAt: 5, resolved: false }],
    boss: { id: "primary", pos: { x: 0, z: 0 }, facing: Math.PI / 2 },
    botSolvers: { generic: [{
      when: { mechanic: "bait" },
      frame: { boss: { from: "facing" } },
      spot: { x: 0, z: 5 },
    }] },
  });
  const spot = genericSolverWaypoint(player({}), w)!;
  expect(spot.x).toBeCloseTo(5);
  expect(spot.z).toBeCloseTo(0);
});

test("frame: { boss: { from: position } } can select a named boss", () => {
  const w = world({
    time: 2,
    active: [{ id: "bait", telegraphStart: 0, resolveAt: 5, resolved: false }],
    boss: { id: "primary", pos: { x: 0, z: 4 }, facing: 0 },
    bosses: [
      { id: "primary", pos: { x: 0, z: 4 }, facing: 0 },
      { id: "add", pos: { x: -3, z: 0 }, facing: 0 },
    ],
    botSolvers: { generic: [{
      when: { mechanic: "bait" },
      frame: { boss: { id: "add", from: "position" } },
      spot: { x: 0, z: 5 },
    }] },
  });
  expect(genericSolverWaypoint(player({}), w)).toEqual({ x: -5, z: 0 });
});

test("a boss-position frame at arena center falls through to the next rule", () => {
  const w = world({
    time: 2,
    active: [{ id: "bait", telegraphStart: 0, resolveAt: 5, resolved: false }],
    boss: { id: "primary", pos: { x: 0, z: 0 }, facing: 0 },
    botSolvers: { generic: [
      { when: { mechanic: "bait" }, frame: { boss: { from: "position" } }, spot: { x: 1, z: 1 } },
      { when: { mechanic: "bait" }, spot: { x: 9, z: 9 } },
    ] },
  });
  expect(genericSolverWaypoint(player({}), w)).toEqual({ x: 9, z: 9 });
});

test("a crystal frame with no matching crystal falls through to the next rule", () => {
  const w = world({
    time: 2,
    active: [{ id: "bait", telegraphStart: 0, resolveAt: 5, resolved: false }],
    crystals: [{ id: "crystal-fire", element: "fire", pos: { x: 9, z: 9 }, spawnAt: 0 }],
    botSolvers: {
      generic: [
        { when: { mechanic: "bait" }, frame: { crystal: "wind" }, spot: { x: 1, z: 1 } },
        { when: { mechanic: "bait" }, spot: { x: 9, z: 9 } },
      ],
    },
  });
  expect(genericSolverWaypoint(player({}), w)).toEqual({ x: 9, z: 9 });
});

test("a rule whose frame cannot be computed falls through to the next rule", () => {
  const w = world({
    time: 2,
    active: [{ id: "bait", telegraphStart: 0, resolveAt: 5, resolved: false }],
    eventPositions: {},
    botSolvers: {
      generic: [
        { when: { mechanic: "bait" }, frame: ["missing"], spot: { x: 1, z: 1 } },
        { when: { mechanic: "bait" }, spot: { x: 9, z: 9 } },
      ],
    },
  });
  expect(genericSolverWaypoint(player({}), w)).toEqual({ x: 9, z: 9 });
});

// loadBotPatterns is the boundary that turns an authored -bots companion into runtime solver rules.
// These two cases exercise that conversion and its end-to-end effect on a bot intent using a
// synthetic raid, so they are not coupled to any authored raid file's contents.

test("loadBotPatterns converts authored solver spot objects to Vec2 and preserves when conditions", () => {
  const w = createWorld(applyBotPatterns(loadRaid(baseRaid), loadBotPatterns({
    players: {},
    solvers: { generic: [
      { when: { mechanic: "stack-1.g0", role: "tank" }, frame: { crystal: "wind" }, spot: { r: -7, z: 7 } },
      { when: { mechanic: "stack-1.g0", role: "healer" }, spot: { x: -4, z: 4 } },
    ] },
  })), 1);

  expect(w.botSolvers?.generic).toHaveLength(2);
  expect(w.botSolvers?.generic?.[0]?.when).toEqual({ mechanic: "stack-1.g0", role: "tank" });
  expect(w.botSolvers?.generic?.[0]?.frame).toEqual({ crystal: "wind" });
  expect(w.botSolvers?.generic?.[0]?.spot).toEqual({ x: -7, z: 7 }); // relative r -> runtime x
  expect(w.botSolvers?.generic?.[1]?.spot).toEqual({ x: -4, z: 4 });
});

test("solver spot schema enforces relative framed and absolute unframed shapes", () => {
  expect(() => loadBotPatterns({
    players: {},
    solvers: { generic: [{
      when: { debuff: "Headwind" },
      frame: { crystal: "wind" },
      spot: { x: 0, z: 5 },
    }] },
  })).toThrow(/frame requires relative/);

  expect(() => loadBotPatterns({
    players: {},
    solvers: { generic: [{ when: { debuff: "Headwind" }, spot: { r: 0, z: 5 } }] },
  })).toThrow(/unframed rule requires absolute/);
});

test("generic solver moves a bot toward the rolled group's stack spot", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ ot: { spawn: [0, 0] } }),
    events: [{ type: "group", id: "stack", t: 0, name: "Stack", rng: true, groups: [["mt"], ["h2"]], telegraph: 5, radius: 6, damage: 50, damageType: "magical" }],
    botSolvers: { generic: [
      { when: { mechanic: "stack.g0", role: "tank" }, spot: { x: -7, z: 7 } },
      { when: { mechanic: "stack.g1", role: "tank" }, spot: { x: 7, z: -7 } },
    ] },
  });
  // The t=0 group mechanic promotes on the first tick; read the bot intent while it telegraphs.
  let w = createWorld(raid, 1);
  w = tick(w, computeBotIntents(w, 1 / 60), 1 / 60);
  expect(w.groupMechanics.length).toBeGreaterThan(0);

  // ot (a bot tank) heads to its role-conditioned spot: g0 -> { x: -7, z: 7 }, g1 -> { x: 7, z: -7 }.
  const intent = computeBotIntents(w, 1 / 60).ot;
  if (w.groupChoices["stack"] === 0) {
    expect(intent.move.x).toBeLessThan(0);
    expect(intent.move.z).toBeGreaterThan(0);
  } else {
    expect(intent.move.x).toBeGreaterThan(0);
    expect(intent.move.z).toBeLessThan(0);
  }
});
