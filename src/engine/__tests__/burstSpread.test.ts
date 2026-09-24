import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { tick } from "../sim";
import { TANK_HP, HEALER_HP, DPS_HP } from "./constants";
import { baseRaid, byId, loadRaid, noMove, roster, runTicks } from "./helpers";

function dtRaid(overrides: {
  carrier?: string;
  spawnOverrides?: Record<string, [number, number]>;
  behavior: Record<string, unknown>;
}) {
  const { carrier = "mt", spawnOverrides = {}, behavior } = overrides;
  const spawns: Record<string, { spawn: [number, number] }> = {};
  for (const [id, pos] of Object.entries(spawnOverrides)) spawns[id] = { spawn: pos };
  return loadRaid({
    ...baseRaid,
    players: roster(spawns),
    events: [{
      type: "apply_effect", t: 0, name: "DT",
      players: [carrier],
      applyEffect: {
        ref: "debug_test_burst_spread", name: "DT", duration: 0.1,
        behavior: { kind: "burstSpread", ...behavior },
      },
    }],
  });
}

test("burstSpread back-compat: old-style schema (no selfShape/followUp) still works", () => {
  const raid = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [2, 0], h1: [10, 0] },
    behavior: { radius: 3, damage: 20, damageType: "magical", knockbackDistance: 6 },
  });
  const world = runTicks(createWorld(raid), noMove, 45);
  const mt = byId(world, "mt");
  const ot = byId(world, "ot");
  const h1 = byId(world, "h1");

  expect(mt.hp).toBe(TANK_HP - 20);
  expect(ot.hp).toBe(TANK_HP - 20);
  expect(h1.hp).toBe(HEALER_HP);
  expect(ot.pos.x).toBeGreaterThan(2);
  expect(mt.pos.x).toBeCloseTo(0);
});

test("burstSpread knockbackDistance: 0 deals damage without knockback", () => {
  const raid = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [2, 0] },
    behavior: { radius: 3, damage: 20, damageType: "magical", knockbackDistance: 0 },
  });
  const world = runTicks(createWorld(raid), noMove, 45);

  expect(byId(world, "ot").hp).toBe(TANK_HP - 20);
  expect(byId(world, "ot").pos.x).toBeCloseTo(2);
});

test("burstSpread selfShape donut: damages in ring, spares in hole", () => {
  const raid = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [3, 0], h1: [1, 0], h2: [8, 0] },
    behavior: { selfShape: "donut", selfInner: 2, radius: 5, damage: 30, damageType: "magical", knockbackDistance: 6 },
  });
  const world = runTicks(createWorld(raid), noMove, 45);

  expect(byId(world, "ot").hp).toBe(TANK_HP - 30);
  expect(byId(world, "h1").hp).toBe(HEALER_HP);
  expect(byId(world, "h2").hp).toBe(HEALER_HP);
  expect(byId(world, "mt").hp).toBe(TANK_HP);
});

test("burstSpread schema guard: selfShape donut without selfInner fails", () => {
  expect(() => dtRaid({
    behavior: { selfShape: "donut", radius: 5, damage: 10, damageType: "magical", knockbackDistance: 6 },
  })).toThrow();
});

test("burstSpread schema guard: selfInner >= radius fails", () => {
  expect(() => dtRaid({
    behavior: { selfShape: "donut", selfInner: 5, radius: 5, damage: 10, damageType: "magical", knockbackDistance: 6 },
  })).toThrow();
});

test("burstSpread schema guard: followUp donut without inner fails", () => {
  expect(() => dtRaid({
    behavior: {
      radius: 3, damage: 10, damageType: "magical", knockbackDistance: 6,
      followUp: { shape: "donut", radius: 5, damage: 10, damageType: "magical" },
    },
  })).toThrow();
});

test("burstSpread schema guard: followUp inner >= followUp radius fails", () => {
  expect(() => dtRaid({
    behavior: {
      radius: 3, damage: 10, damageType: "magical", knockbackDistance: 6,
      followUp: { shape: "donut", inner: 5, radius: 5, damage: 10, damageType: "magical" },
    },
  })).toThrow();
});

test("burstSpread followUp targeting: hits 2 closest non-carriers, excludes carrier", () => {
  const raid = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [1, 0], h1: [3, 0], h2: [20, 0], r1: [25, 0] },
    behavior: {
      radius: 0.1,
      damage: 10, damageType: "magical", knockbackDistance: 0.1,
      followUp: { mode: "closest", count: 2, shape: "circle", radius: 0.5, damage: 50, damageType: "magical" },
    },
  });
  const world = runTicks(createWorld(raid), noMove, 45);

  expect(byId(world, "mt").hp).toBe(TANK_HP - 10);
  expect(byId(world, "ot").hp).toBe(TANK_HP - 50);
  expect(byId(world, "h1").hp).toBe(HEALER_HP - 50);
  expect(byId(world, "h2").hp).toBe(HEALER_HP);
  expect(byId(world, "r1").hp).toBe(DPS_HP);
});

test("burstSpread followUp originCrystal targets by crystal distance", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [0, 0] }, ot: { spawn: [1, 0] }, h1: { spawn: [10, 0] }, h2: { spawn: [14, 0] } }),
    crystals: [
      { kind: "single", element: "wind", pos: [0, 10] },
      { kind: "single", element: "fire", pos: [10, 0] },
      { kind: "single", element: "water", pos: [0, -10] },
      { kind: "single", element: "earth", pos: [-10, 0] },
    ],
    events: [{
      type: "apply_effect", t: 0, name: "DT", players: ["mt"],
      applyEffect: {
        ref: "debug_test_burst_spread", name: "DT", duration: 0.1,
        behavior: {
          kind: "burstSpread",
          radius: 0.1, damage: 1, damageType: "magical", knockbackDistance: 0,
          followUp: { mode: "closest", count: 1, originCrystal: "fire", shape: "circle", radius: 0.5, damage: 50, damageType: "magical" },
        },
      },
    }],
  });
  const world = runTicks(createWorld(raid), noMove, 90);

  expect(byId(world, "ot").hp).toBe(TANK_HP);
  expect(byId(world, "h1").hp).toBe(HEALER_HP - 50);
});

test("burstSpread originCrystal followUp resolves one second after the self burst", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [0, 0] }, h1: { spawn: [10, 0] } }),
    crystals: [
      { kind: "single", element: "wind", pos: [0, 10] },
      { kind: "single", element: "fire", pos: [10, 0] },
      { kind: "single", element: "water", pos: [0, -10] },
      { kind: "single", element: "earth", pos: [-10, 0] },
    ],
    events: [{
      type: "apply_effect", t: 0, name: "DT", players: ["mt"],
      applyEffect: {
        ref: "debug_test_burst_spread", name: "DT", duration: 0.1,
        behavior: {
          kind: "burstSpread",
          radius: 0.1, damage: 1, damageType: "magical", knockbackDistance: 0,
          followUp: { mode: "closest", count: 1, originCrystal: "fire", shape: "circle", radius: 0.5, damage: 50, damageType: "magical" },
        },
      },
    }],
  });
  let world = createWorld(raid);
  for (let i = 0; i < 30; i++) world = tick(world, noMove, 1 / 60);

  expect(byId(world, "mt").hp).toBe(TANK_HP - 1);
  expect(byId(world, "h1").hp).toBe(HEALER_HP);
  expect(world.pendingBurstSpreadFollowUps).toHaveLength(1);

  for (let i = 0; i < 70; i++) world = tick(world, noMove, 1 / 60);

  expect(byId(world, "h1").hp).toBe(HEALER_HP - 50);
  expect(world.pendingBurstSpreadFollowUps).toHaveLength(0);
});

test("burstSpread followUp originCrystal: two carriers fire one shared set of count AOEs", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({
      mt: { spawn: [0, -9] }, ot: { spawn: [10, 0] }, h1: { spawn: [0, -8] },
      h2: { spawn: [12, 0] }, r1: { spawn: [0, 12] }, r2: { spawn: [-12, 0] },
    }),
    crystals: [
      { kind: "single", element: "wind", pos: [0, 10] },
      { kind: "single", element: "fire", pos: [10, 0] },
      { kind: "single", element: "water", pos: [0, -10] },
      { kind: "single", element: "earth", pos: [-10, 0] },
    ],
    events: [{
      type: "apply_effect", t: 0, name: "DT", players: ["mt", "ot"],
      applyEffect: {
        ref: "debug_test_burst_spread", name: "DT", duration: 0.1,
        behavior: {
          kind: "burstSpread",
          selfShape: "donut", selfInner: 1, radius: 3, damage: 1, damageType: "magical", knockbackDistance: 0,
          followUp: { mode: "closest", count: 2, originCrystal: "water", shape: "circle", radius: 0.5, damage: 50, damageType: "magical" },
        },
      },
    }],
  });
  const world = runTicks(createWorld(raid), noMove, 90);

  const fuVisuals = world.active.filter(m => m.id.includes("-fu-") && m.resolved);
  expect(fuVisuals).toHaveLength(2);
  expect(fuVisuals.some(m => m.id.includes("-fu-mt"))).toBe(true);
  expect(fuVisuals.some(m => m.id.includes("-fu-h1"))).toBe(true);
});

test("burstSpread followUp shape (Entropy): circle self-pop + donut follow-up", () => {
  const raid = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [5, 0], h1: [6, 0], h2: [5.3, 0] },
    behavior: {
      selfShape: "circle", radius: 2, damage: 5, damageType: "magical", knockbackDistance: 1,
      followUp: { mode: "closest", count: 1, shape: "donut", inner: 0.5, radius: 2, damage: 80, damageType: "magical" },
    },
  });
  const world = runTicks(createWorld(raid), noMove, 45);

  expect(byId(world, "h1").hp).toBe(HEALER_HP - 80);
  expect(byId(world, "h2").hp).toBe(HEALER_HP);
});

test("burstSpread followUp shape (Dynamic Fluid): donut self-pop + circle follow-up", () => {
  const raid = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [7, 0], h1: [7.5, 0] },
    behavior: {
      selfShape: "donut", selfInner: 2, radius: 5, damage: 5, damageType: "magical", knockbackDistance: 1,
      followUp: { mode: "closest", count: 1, shape: "circle", radius: 1, damage: 60, damageType: "magical" },
    },
  });
  const world = runTicks(createWorld(raid), noMove, 45);

  expect(byId(world, "ot").hp).toBe(TANK_HP - 60);
  expect(byId(world, "h1").hp).toBe(HEALER_HP - 60);
  expect(byId(world, "mt").hp).toBe(TANK_HP);
});

test("burstSpread followUp knockback: pushes from follow-up center when set, omitted = no KB", () => {
  const raidWithKb = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [5, 0], h1: [5.3, 0] },
    behavior: {
      radius: 0.1, damage: 1, damageType: "magical", knockbackDistance: 1,
      followUp: { mode: "closest", count: 1, shape: "circle", radius: 1, damage: 10, damageType: "magical", knockbackDistance: 10 },
    },
  });
  const worldWithKb = runTicks(createWorld(raidWithKb), noMove, 45);
  expect(byId(worldWithKb, "h1").pos.x).toBeGreaterThan(5.3);

  const raidNoKb = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [5, 0], h1: [5.3, 0] },
    behavior: {
      radius: 0.1, damage: 1, damageType: "magical", knockbackDistance: 1,
      followUp: { mode: "closest", count: 1, shape: "circle", radius: 1, damage: 10, damageType: "magical" },
    },
  });
  const worldNoKb = runTicks(createWorld(raidNoKb), noMove, 45);
  expect(byId(worldNoKb, "h1").pos.x).toBeCloseTo(5.3, 1);
});

test("burstSpread followUp visual: one resolved AOE visual per follow-up target", () => {
  const raid = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [2, 0], h1: [4, 0], h2: [20, 0] },
    behavior: {
      radius: 0.1, damage: 1, damageType: "magical", knockbackDistance: 1,
      followUp: { mode: "closest", count: 2, shape: "circle", radius: 0.5, damage: 10, damageType: "magical" },
    },
  });
  const world = runTicks(createWorld(raid), noMove, 20);

  const fuVisuals = world.active.filter(m => m.id.includes("-fu-") && m.resolved);
  expect(fuVisuals).toHaveLength(2);
  expect(fuVisuals.some(m => m.id.includes("-fu-ot"))).toBe(true);
  expect(fuVisuals.some(m => m.id.includes("-fu-h1"))).toBe(true);
});

test("burstSpread determinism: same positions produce identical HP and log entries", () => {
  const makeRaid = () => dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [2, 0], h1: [4, 0] },
    behavior: {
      radius: 3, damage: 15, damageType: "magical", knockbackDistance: 5,
      followUp: { mode: "closest", count: 2, shape: "circle", radius: 1.5, damage: 25, damageType: "magical" },
    },
  });
  const world1 = runTicks(createWorld(makeRaid()), noMove, 45);
  const world2 = runTicks(createWorld(makeRaid()), noMove, 45);

  expect(world1.players.map(p => p.hp)).toEqual(world2.players.map(p => p.hp));
  const dtLogs1 = world1.log.filter(e => e.mechanic === "DT");
  const dtLogs2 = world2.log.filter(e => e.mechanic === "DT");
  expect(dtLogs1).toEqual(dtLogs2);
});
