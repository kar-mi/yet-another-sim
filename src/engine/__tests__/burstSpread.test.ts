import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { TANK_HP, HEALER_HP, DPS_HP } from "./constants";
import { baseRaid, byId, loadRaid, noMove, roster, runTicks } from "./helpers";

// ------ helpers ------

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
        name: "DT", kind: "debuff", duration: 0.1,
        behavior: { kind: "burstSpread", ...behavior },
      },
    }],
  });
}

// ------ tests ------

test("burstSpread back-compat: old-style schema (no selfShape/followUp) still works", () => {
  const raid = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [2, 0], h1: [10, 0] },
    behavior: { radius: 3, damage: 20, damageType: "magical", knockbackDistance: 6 },
  });
  const world = runTicks(createWorld(raid), noMove, 45);
  const mt = byId(world, "mt");
  const ot = byId(world, "ot");
  const h1 = byId(world, "h1");

  expect(mt.hp).toBe(TANK_HP - 20);   // carrier: in self-pop circle, no KB
  expect(ot.hp).toBe(TANK_HP - 20);   // distance 2 < radius 3 → hit
  expect(h1.hp).toBe(HEALER_HP);      // distance 10 > radius 3 → miss
  expect(ot.pos.x).toBeGreaterThan(2); // ot knocked back
  expect(mt.pos.x).toBeCloseTo(0);     // carrier not knocked back
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
  // mt carrier at [0,0], donut inner=2 outer=5
  // ot at [3,0] → distance 3, in ring → hit
  // h1 at [1,0] → distance 1 < inner 2, in hole → miss
  // h2 at [8,0] → distance 8 > outer 5 → miss
  const raid = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [3, 0], h1: [1, 0], h2: [8, 0] },
    behavior: { selfShape: "donut", selfInner: 2, radius: 5, damage: 30, damageType: "magical", knockbackDistance: 6 },
  });
  const world = runTicks(createWorld(raid), noMove, 45);

  expect(byId(world, "ot").hp).toBe(TANK_HP - 30);    // in ring
  expect(byId(world, "h1").hp).toBe(HEALER_HP);       // in hole
  expect(byId(world, "h2").hp).toBe(HEALER_HP);       // outside outer
  expect(byId(world, "mt").hp).toBe(TANK_HP);         // carrier at center (inside hole, no damage)
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
  // mt (carrier) at [0,0]; ot at [1,0] (closest); h1 at [3,0] (2nd); h2/r1/others far
  // followUp: count=2, circle radius=0.5 (tiny — only hits the centered player)
  const raid = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [1, 0], h1: [3, 0], h2: [20, 0], r1: [25, 0] },
    behavior: {
      radius: 0.1,           // tiny self-pop, only hits mt
      damage: 10, damageType: "magical", knockbackDistance: 0.1,
      followUp: { mode: "closest", count: 2, shape: "circle", radius: 0.5, damage: 50, damageType: "magical" },
    },
  });
  const world = runTicks(createWorld(raid), noMove, 45);

  expect(byId(world, "mt").hp).toBe(TANK_HP - 10);    // self-pop only
  expect(byId(world, "ot").hp).toBe(TANK_HP - 50);    // follow-up target #1
  expect(byId(world, "h1").hp).toBe(HEALER_HP - 50);  // follow-up target #2
  expect(byId(world, "h2").hp).toBe(HEALER_HP);       // not targeted
  expect(byId(world, "r1").hp).toBe(DPS_HP);          // not targeted
});

test("burstSpread followUp shape (Entropy): circle self-pop + donut follow-up", () => {
  // Entropy: carrier mt at [0,0], selfShape circle r=2, followUp donut inner=1 outer=4
  // ot at [5,0] → follow-up target; player in ot's donut ring: h1 at [6,0] (dist 1 from ot, in ring)
  // h2 at [5.3,0] (dist 0.3 from ot, inside inner=1 → spared)
  const raid = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [5, 0], h1: [6, 0], h2: [5.3, 0] },
    behavior: {
      selfShape: "circle", radius: 2, damage: 5, damageType: "magical", knockbackDistance: 1,
      followUp: { mode: "closest", count: 1, shape: "donut", inner: 0.5, radius: 2, damage: 80, damageType: "magical" },
    },
  });
  const world = runTicks(createWorld(raid), noMove, 45);

  expect(byId(world, "h1").hp).toBe(HEALER_HP - 80);  // in the donut ring (dist 1 from ot, > inner 0.5, < outer 2)
  expect(byId(world, "h2").hp).toBe(HEALER_HP);       // inside the hole (dist 0.3 < inner 0.5) → spared
});

test("burstSpread followUp shape (Dynamic Fluid): donut self-pop + circle follow-up", () => {
  // Dynamic Fluid: carrier mt at [0,0], selfShape donut inner=2 outer=5
  // ot at [7,0] → follow-up target; h1 at [7.5,0] (inside follow-up circle r=1)
  const raid = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [7, 0], h1: [7.5, 0] },
    behavior: {
      selfShape: "donut", selfInner: 2, radius: 5, damage: 5, damageType: "magical", knockbackDistance: 1,
      followUp: { mode: "closest", count: 1, shape: "circle", radius: 1, damage: 60, damageType: "magical" },
    },
  });
  const world = runTicks(createWorld(raid), noMove, 45);

  expect(byId(world, "ot").hp).toBe(TANK_HP - 60);    // follow-up center: in its own circle (dist 0)
  expect(byId(world, "h1").hp).toBe(HEALER_HP - 60);  // dist 0.5 from ot < radius 1 → in circle
  expect(byId(world, "mt").hp).toBe(TANK_HP);         // mt at [0,0]: outside donut outer 5 → no self-pop; not a follow-up center
});

test("burstSpread followUp knockback: pushes from follow-up center when set, omitted = no KB", () => {
  // mt (carrier) at [0,0], ot (follow-up center) at [5,0]
  // h1 at [5.3,0] → 0.3 from ot, inside follow-up circle r=1 → knocked back from [5,0]
  const raidWithKb = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [5, 0], h1: [5.3, 0] },
    behavior: {
      radius: 0.1, damage: 1, damageType: "magical", knockbackDistance: 1,
      followUp: { mode: "closest", count: 1, shape: "circle", radius: 1, damage: 10, damageType: "magical", knockbackDistance: 10 },
    },
  });
  const worldWithKb = runTicks(createWorld(raidWithKb), noMove, 45);
  expect(byId(worldWithKb, "h1").pos.x).toBeGreaterThan(5.3); // knocked away from ot at [5,0]

  const raidNoKb = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [5, 0], h1: [5.3, 0] },
    behavior: {
      radius: 0.1, damage: 1, damageType: "magical", knockbackDistance: 1,
      followUp: { mode: "closest", count: 1, shape: "circle", radius: 1, damage: 10, damageType: "magical" },
    },
  });
  const worldNoKb = runTicks(createWorld(raidNoKb), noMove, 45);
  expect(byId(worldNoKb, "h1").pos.x).toBeCloseTo(5.3, 1); // no KB, stays put
});

test("burstSpread followUp visual: one resolved AOE visual per follow-up target", () => {
  // Carrier mt, followUp count=2, targets ot and h1
  const raid = dtRaid({
    spawnOverrides: { mt: [0, 0], ot: [2, 0], h1: [4, 0], h2: [20, 0] },
    behavior: {
      radius: 0.1, damage: 1, damageType: "magical", knockbackDistance: 1,
      followUp: { mode: "closest", count: 2, shape: "circle", radius: 0.5, damage: 10, damageType: "magical" },
    },
  });
  // Run just past expiry (effect at t≈1/60, expires at t≈1/60+0.1) but within linger window (0.7s)
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
