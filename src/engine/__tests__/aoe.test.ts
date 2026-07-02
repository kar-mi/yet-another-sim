import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { DPS_HP, HEALER_HP, TANK_HP } from "./constants";
import { HUMAN, baseRaid, byId, effect, human, loadRaid, roster, runTicks, withPlayerEffect } from "./helpers";
import type { Vec } from "./helpers";

test("player takes damage when inside AOE at resolve", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "TestAOE", telegraph: 2, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 10 } }],
    players: roster({ m1: { spawn: [0, 0] } }),
  });
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(5.1 * 60));
  expect(human(world).hp).toBeLessThan(100);
});

test("player survives when outside AOE at resolve", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "TestAOE", telegraph: 2, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 5 } }],
    players: roster({ m1: { spawn: [0, 15] } }),
  });
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(5.1 * 60));
  expect(human(world).hp).toBe(DPS_HP);
});


test("jumping does not avoid ground-targeted mechanics", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 0.1, name: "GroundAOE", telegraph: 0.01, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 10 } }],
  });
  let world = createWorld(raid);

  world = tick(world, { [HUMAN]: { move: { x: 0, z: 0 }, jump: true } }, 1 / 60);
  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(0.2 * 60));

  expect(human(world).y).toBeGreaterThan(0);
  expect(human(world).hp).toBeLessThan(100);
});

test("targeted mechanic hits the closest player and spares the rest", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 3] }, m2: { spawn: [0, 12] } }),
    events: [{ t: 1, name: "Near Bait", type: "targeted", targetMode: "closest", radius: 2, telegraph: 1, damage: 50, damageType: "physical" }],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(2.1 * 60));
  expect(human(world).hp).toBeLessThan(100); // m1 is closest
  for (const p of world.players) {
    if (p.id !== HUMAN) expect(p.hp).toBe(p.maxHp); // spared -> full HP (role-based max)
  }
});

test("targeted mechanic respects the role filter when selecting furthest", () => {
  const raid = loadRaid({
    ...baseRaid,
    // mt is furthest overall, but the bait is dps-only; m2 is the furthest dps.
    players: roster({ mt: { spawn: [0, 14] }, m1: { spawn: [0, 5] }, m2: { spawn: [0, 9] } }),
    events: [{ t: 1, name: "Far Bait", type: "targeted", targetMode: "furthest", role: "dps", radius: 2, telegraph: 1, damage: 50, damageType: "physical" }],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(2.1 * 60));
  expect(world.players.find(p => p.id === "m2")!.hp).toBeLessThan(100);
  expect(world.players.find(p => p.id === "m1")!.hp).toBe(DPS_HP);
  expect(world.players.find(p => p.id === "mt")!.hp).toBe(TANK_HP); // tank, unhit
});

test("targeted mechanic with aggro mode hits the boss's current target", () => {
  const raid = loadRaid({
    ...baseRaid,
    // m1 is closest and ot is furthest, but aggro must pick mt (seeded top threat).
    players: roster({ mt: { spawn: [0, 5] }, ot: { spawn: [0, 14] }, m1: { spawn: [0, 0] } }),
    events: [{ t: 1, name: "Aggro Buster", type: "targeted", targetMode: "aggro", radius: 2, telegraph: 1, damage: 50, damageType: "physical" }],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(2.1 * 60));
  expect(world.boss.currentTarget).toBe("mt");
  expect(world.players.find(p => p.id === "mt")!.hp).toBeLessThan(TANK_HP);
  expect(world.players.find(p => p.id === "ot")!.hp).toBe(TANK_HP); // furthest, spared
  expect(human(world).hp).toBe(DPS_HP); // m1 closest, spared
});


test("targeted mechanic picks the near/far target at cast end, not cast start", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 3] }, m2: { spawn: [0, 6] } }),
    events: [{ t: 0.1, name: "Near Bait", type: "targeted", targetMode: "closest", radius: 2, telegraph: 1.5, damage: 50, damageType: "physical" }],
  });
  // m1 is closest at cast start, but walks outward and is no longer closest by cast end,
  // so the circle should land on m2 instead.
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 1 } } }, Math.ceil(1.7 * 60));
  expect(human(world).alive).toBe(true);
  expect(human(world).hp).toBe(DPS_HP);
  expect(world.players.find(p => p.id === "m2")!.hp).toBeLessThan(100);
});

test("targeted bait circle lingers in active after resolving, then drops", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] } }),
    events: [{ t: 0.5, name: "Bait", type: "targeted", targetMode: "closest", radius: 3, telegraph: 0.5, damage: 10, damageType: "physical" }],
  });
  // resolves at t = 1.0
  const lingering = runTicks(createWorld(raid), {}, Math.ceil(1.2 * 60));
  expect(lingering.active.some(m => m.id === "targeted-0" && m.resolved)).toBe(true);
  // well past resolveAt + linger window (1.0 + 0.7)
  const gone = runTicks(createWorld(raid), {}, Math.ceil(3.0 * 60));
  expect(gone.active.some(m => m.id === "targeted-0")).toBe(false);
});

test("targeted mechanic splashes players standing inside the circle", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 3] }, m2: { spawn: [0, 6] } }),
    events: [{ t: 1, name: "Stack", type: "targeted", targetMode: "closest", radius: 5, telegraph: 1, damage: 50, damageType: "physical" }],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(2.1 * 60));
  expect(human(world).hp).toBeLessThan(100); // m1 targeted
  expect(world.players.find(p => p.id === "m2")!.hp).toBeLessThan(100); // splashed
});


// --- Facing-relative mechanics (positionals) ----------------------------

// mt seeded as target at [0,10] makes the boss face +Z, so "front" is +Z.
const facingNorthRoster: Record<string, { spawn: Vec }> = {
  mt: { spawn: [0, 10] }, m1: { spawn: [0, 6] }, m2: { spawn: [0, -6] }, r1: { spawn: [6, 0] },
};

test("a boss-anchored cone snapshots boss facing and hits players in front", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster(facingNorthRoster),
    events: [{
      t: 0, name: "Cleave", telegraph: 1, damage: 50, damageType: "physical" as const,
      shape: { kind: "cone", angleDeg: 90, length: 15 }, anchor: "boss", directionFrom: "bossFacing",
    }],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(1.1 * 60));
  expect(byId(world, "m1").hp).toBeLessThan(100); // in front (+Z), inside the cone
  expect(byId(world, "m2").hp).toBe(DPS_HP);          // behind the boss, spared
});

test("boss-anchored circle and donut snapshot the boss position", () => {
  const raid = loadRaid({
    ...baseRaid,
    boss: { pos: [5, 0] },
    players: roster({ mt: { spawn: [5, 1] }, m1: { spawn: [5, 0] }, m2: { spawn: [7, 0] }, r1: { spawn: [0, 0] } }),
    events: [
      {
        t: 0, name: "Circle", telegraph: 1, damage: 10, damageType: "physical" as const,
        anchor: "boss", shape: { kind: "circle", center: [0, 0], radius: 1 },
      },
      {
        t: 2, name: "Donut", telegraph: 1, damage: 10, damageType: "physical" as const,
        anchor: "boss", shape: { kind: "donut", center: [0, 0], inner: 1, outer: 3 },
      },
    ],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(3.1 * 60));

  expect(byId(world, "m1").hp).toBe(DPS_HP - 10); // circle centered on boss
  expect(byId(world, "m2").hp).toBe(DPS_HP - 10); // donut centered on boss
  expect(byId(world, "r1").hp).toBe(DPS_HP);      // would be hit if either stayed centered at [0,0]
});

test("bossRelativeCenter resolves circle offsets from boss position", () => {
  const raid = loadRaid({
    ...baseRaid,
    boss: { pos: [0, 18] },
    players: roster({ m1: { spawn: [-8, 0] }, m2: { spawn: [8, 0] } }),
    events: [
      {
        t: 0, name: "Right Hand", telegraph: 1, damage: 10, damageType: "physical" as const,
        bossId: "boss", bossRelativeCenter: { lateral: 8, forward: 0 },
        shape: { kind: "circle", center: [0, 0], radius: 6 },
      },
      {
        t: 2, name: "Left Hand", telegraph: 1, damage: 10, damageType: "physical" as const,
        bossId: "boss", bossRelativeCenter: { lateral: -8, forward: 0 },
        shape: { kind: "circle", center: [0, 0], radius: 6 },
      },
    ],
  });

  const afterRight = runTicks(createWorld(raid), {}, Math.ceil(1.1 * 60));
  expect(byId(afterRight, "m1").hp).toBe(DPS_HP - 10);
  expect(byId(afterRight, "m2").hp).toBe(DPS_HP);

  const afterLeft = runTicks(afterRight, {}, Math.ceil(2 * 60));
  expect(byId(afterLeft, "m1").hp).toBe(DPS_HP - 10);
  expect(byId(afterLeft, "m2").hp).toBe(DPS_HP - 10);
});

test("aimAtPlayer points cone geometry without turning the boss", () => {
  const raid = loadRaid({
    ...baseRaid,
    boss: { pos: [0, 0] },
    players: roster({ h1: { spawn: [-8, 2] }, m1: { spawn: [-8, 2] }, m2: { spawn: [8, 0] } }),
    events: [{
      t: 0, name: "Aimed Cone", telegraph: 1, damage: 10, damageType: "physical" as const,
      anchor: "boss", aimAtPlayer: "h1",
      shape: { kind: "cone", angleDeg: 20, length: 20 },
    }],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(1.1 * 60));

  expect(world.boss.facing).toBeCloseTo(0);
  expect(byId(world, "m1").hp).toBe(DPS_HP - 10);
  expect(byId(world, "m2").hp).toBe(DPS_HP);
});

function positionalRaid(positional: { center: number; width: number }, over = facingNorthRoster) {
  return loadRaid({
    ...baseRaid,
    players: roster(over),
    events: [{
      t: 0, name: "Directional", telegraph: 1, damage: 20, damageType: "physical" as const,
      shape: { kind: "circle", center: [0, 0], radius: 20 }, positional,
    }],
  });
}

test("a rear ±45° arc hits only players behind the boss", () => {
  // center = PI (rear), width = PI/2 (±45°).
  const world = runTicks(createWorld(positionalRaid({ center: Math.PI, width: Math.PI / 2 })), {}, Math.ceil(1.1 * 60));
  expect(byId(world, "m2").hp).toBe(80);  // rear -> hit
  expect(byId(world, "m1").hp).toBe(DPS_HP); // front -> spared
  expect(byId(world, "r1").hp).toBe(DPS_HP); // flank (east) -> spared
});

test("an intercardinal arc (front-right) hits only that diagonal", () => {
  // center = PI/4 (NE relative to facing), width = PI/2 (±45°). r2 sits NE.
  const world = runTicks(createWorld(positionalRaid(
    { center: Math.PI / 4, width: Math.PI / 2 },
    { ...facingNorthRoster, r2: { spawn: [8, 8] as Vec } },
  )), {}, Math.ceil(1.1 * 60));
  expect(byId(world, "r2").hp).toBe(80);  // NE diagonal -> hit
  expect(byId(world, "m2").hp).toBe(DPS_HP); // rear -> spared
});

test("a half cleave (180° front arc) hits the whole front", () => {
  // center = 0 (front), width = PI (the front half).
  const world = runTicks(createWorld(positionalRaid({ center: 0, width: Math.PI })), {}, Math.ceil(1.1 * 60));
  expect(byId(world, "m1").hp).toBe(80);  // front -> hit
  expect(byId(world, "m2").hp).toBe(DPS_HP); // rear -> spared
});

test("directionOffset rotates a boss-anchored cone (rear cleave)", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster(facingNorthRoster), // boss faces +Z (north)
    events: [{
      t: 0, name: "Rear Cone", telegraph: 1, damage: 30, damageType: "physical" as const,
      anchor: "boss", directionFrom: "bossFacing", directionOffset: Math.PI, // point south
      shape: { kind: "cone", angleDeg: 90, length: 25 },
    }],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(1.1 * 60));
  expect(byId(world, "m2").hp).toBe(70);  // behind the boss, inside the rear cone
  expect(byId(world, "m1").hp).toBe(DPS_HP); // in front, spared
});

test("lockFacing freezes the boss facing for the duration of the cast", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [10, 0] }, ot: { spawn: [0, 10] } }),
    events: [{
      t: 0, name: "Locked Cast", telegraph: 3, damage: 0, damageType: "physical" as const,
      lockFacing: true, shape: { kind: "circle", center: [0, 0], radius: 1 },
    }],
  });
  let w = tick(createWorld(raid), { mt: { move: { x: 0, z: 0 } } }, 1 / 60);
  const lockedFacing = w.boss.facing;
  expect(lockedFacing).toBeCloseTo(Math.atan2(10, 0)); // faces mt (east) at cast start

  // ot provokes mid-cast: target flips but the boss holds its facing.
  w = tick(w, { ot: { move: { x: 0, z: 0 }, provoke: true } }, 1 / 60);
  w = runTicks(w, {}, 30); // still within the 3s cast
  expect(w.boss.currentTarget).toBe("ot");
  expect(w.boss.facing).toBeCloseTo(lockedFacing); // frozen

  // once the cast resolves, facing resumes toward the current target (ot, north).
  w = runTicks(w, {}, Math.ceil(3 * 60));
  expect(w.boss.facing).toBeCloseTo(Math.atan2(0, 10));
});

// --- Stored cleave + linked bait -----------------------------------------

// h1 sits closest (east, dist 4) so a "closest" bait targets it and the boss faces east (+X, ~π/2).
// m2 is the east victim (front of the locked facing), m1 the west victim (rear). The stored cleave is
// linked to the bait and detonates with it, aimed from the boss's locked facing + its directionOffset.
const storedBaitRoster: Record<string, { spawn: Vec }> = {
  h1: { spawn: [4, 0] }, m2: { spawn: [14, 0] }, m1: { spawn: [-14, 0] },
};

function storedBaitRaid(directionOffset: number, targetMode: "random" | "closest" | "furthest" = "closest") {
  return loadRaid({
    ...baseRaid,
    duration: 8,
    players: roster(storedBaitRoster),
    events: [
      {
        type: "aoe", id: "stored", t: 1, name: "Stored Ending", deferred: true,
        anchor: "boss", directionFrom: "bossFacing", directionOffset,
        telegraph: 1, damage: 50, damageType: "physical" as const,
        shape: { kind: "cone", angleDeg: 90, length: 30 }, telegraphMode: "resolve", showCastBar: true,
      },
      {
        type: "bait", id: "bait", t: 4, name: "All Things Ending", targetMode,
        angleDeg: 60, length: 30, telegraph: 2, damage: 40, damageType: "physical" as const,
        link: "stored", showCastBar: true,
      },
    ],
  });
}

test("a deferred stored cleave stays dormant and hidden until its linked bait arms it", () => {
  const world = runTicks(createWorld(storedBaitRaid(0)), {}, Math.ceil(3 * 60)); // t=3: cast1 done, bait not yet
  const stored = world.active.find(m => m.id === "stored");
  expect(stored).toBeDefined();
  expect(stored!.resolved).toBe(false);
  expect(stored!.showTelegraph).toBe(false); // no ground telegraph while stored
  expect(byId(world, "m1").hp).toBe(DPS_HP);     // nothing has resolved yet
  expect(byId(world, "m2").hp).toBe(DPS_HP);
});

test("a bait turns the boss to face its target and locks facing during the cast", () => {
  const world = runTicks(createWorld(storedBaitRaid(0)), {}, Math.ceil(5 * 60)); // mid bait cast (4..6)
  const h1 = byId(world, "h1");
  expect(world.boss.currentTarget).toBe("mt");             // mt still holds aggro (north)
  expect(world.boss.facing).toBeCloseTo(Math.atan2(h1.pos.x - world.boss.pos.x, h1.pos.z - world.boss.pos.z));
});

test("a resolve-only stored cleave is hidden while armed and flashes at resolve", () => {
  let world = tick(createWorld(storedBaitRaid(0)), {}, 5); // mid bait cast (4..6)
  const armed = world.active.find(m => m.id === "stored");
  expect(armed?.armed).toBe(true);
  expect(armed?.resolved).toBe(false);
  expect(armed?.showTelegraph).toBe(true);
  expect(armed?.telegraphMode).toBe("resolve");

  world = tick(world, {}, 1); // resolveAt=6; active lingers for the resolved flash
  const flashed = world.active.find(m => m.id === "stored");
  expect(flashed?.resolved).toBe(true);
  expect(flashed?.showTelegraph).toBe(true);
  expect(flashed?.telegraphMode).toBe("resolve");

  world = tick(world, {}, 0.59);
  expect(world.active.find(m => m.id === "stored")?.resolved).toBe(true);

  world = tick(world, {}, 0.02);
  expect(world.active.some(m => m.id === "stored")).toBe(false);
});

test("future stored cleave fires toward the bait (front); rear is spared", () => {
  const world = runTicks(createWorld(storedBaitRaid(0)), {}, Math.ceil(6.1 * 60));
  expect(byId(world, "m2").hp).toBeLessThan(100); // east (toward bait) -> hit
  expect(byId(world, "m1").hp).toBe(DPS_HP);         // west (rear) -> spared
});

test("past stored cleave fires away from the bait (rear)", () => {
  const world = runTicks(createWorld(storedBaitRaid(Math.PI)), {}, Math.ceil(6.1 * 60));
  expect(byId(world, "m1").hp).toBeLessThan(100); // west (rear, away from bait) -> hit by the cleave
});

test("the linked stored cleave detonates on the same tick the bait resolves", () => {
  let w = runTicks(createWorld(storedBaitRaid(0)), {}, Math.ceil(5.95 * 60)); // just before resolveAt=6
  expect(byId(w, "m2").hp).toBe(DPS_HP);                                  // nothing resolved yet
  expect(w.active.find(m => m.id === "stored")?.resolved).toBe(false); // armed but not yet detonated
  w = runTicks(w, {}, 6); // step past t=6
  expect(byId(w, "m2").hp).toBeLessThan(100); // the linked stored cleave detonates at the bait's resolve
});

test("random bait selection is deterministic under the seeded RNG", () => {
  const raid = storedBaitRaid(0, "random");
  const w1 = runTicks(createWorld(raid, 1), {}, Math.ceil(6.1 * 60));
  const w2 = runTicks(createWorld(raid, 1), {}, Math.ceil(6.1 * 60));
  expect(w1.players.map(p => p.hp)).toEqual(w2.players.map(p => p.hp));
  expect(w1.boss.facing).toBeCloseTo(w2.boss.facing);
});

test("bait can pick stored cleave direction from the selected target's active effect", () => {
  const raid = loadRaid({
    ...baseRaid,
    duration: 8,
    players: roster(storedBaitRoster),
    events: [
      {
        type: "aoe", id: "stored", t: 1, name: "Stored Ending", deferred: true,
        anchor: "boss", directionFrom: "bossFacing", directionOffset: Math.PI,
        telegraph: 1, damage: 50, damageType: "physical" as const,
        shape: { kind: "cone", angleDeg: 90, length: 30 }, telegraphMode: "resolve", showCastBar: true,
      },
      {
        type: "bait", id: "bait", t: 4, name: "All Things Ending", targetMode: "closest",
        telegraph: 2, link: "stored", showCastBar: true,
        directionOffsetByEffect: { "Forsaken Future": 0, "Forsaken Past": Math.PI },
      },
    ],
  });

  const futureWorld = runTicks(
    withPlayerEffect(createWorld(raid), "h1", effect({ name: "Forsaken Future", duration: 10 })),
    {},
    Math.ceil(6.1 * 60),
  );
  expect(byId(futureWorld, "m2").hp).toBeLessThan(100);
  expect(byId(futureWorld, "m1").hp).toBe(DPS_HP);

  const pastWorld = runTicks(
    withPlayerEffect(createWorld(raid), "h1", effect({ name: "Forsaken Past", duration: 10 })),
    {},
    Math.ceil(6.1 * 60),
  );
  expect(byId(pastWorld, "m1").hp).toBeLessThan(100);
  expect(byId(pastWorld, "m2").hp).toBe(DPS_HP);
});

// --- requireFullHp (White Hole) ---

const whiteHoleAoe = {
  t: 3,
  name: "White Hole",
  telegraph: 2,
  damage: 9999,
  damageType: "true" as const,
  requireFullHp: true,
  shape: { kind: "circle" as const, center: [0, 0] as [number, number], radius: 0.1 },
};

test("requireFullHp: below-full player dies, full-HP player is spared", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      { type: "set_hp", t: 1, name: "Damage", amount: 50, players: ["m1"] },
      whiteHoleAoe,
    ],
    players: roster({ m1: { spawn: [0, 0] }, m2: { spawn: [0, 5] } }),
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(5.1 * 60));
  expect(byId(world, "m1").alive).toBe(false);
  for (const p of world.players) {
    if (p.id !== "m1") {
      expect(p.alive).toBe(true);
      expect(p.hp).toBe(p.maxHp);
    }
  }
});

test("requireFullHp: position is irrelevant — distant below-full player still dies", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      { type: "set_hp", t: 1, name: "Damage", amount: 50, players: ["m1"] },
      whiteHoleAoe,
    ],
    // m1 is far from shape center (0,0) — should still be hit by the raidwide
    players: roster({ m1: { spawn: [0, 50] } }),
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(5.1 * 60));
  expect(byId(world, "m1").alive).toBe(false);
});

test("requireFullHp: tank uses own maxHp threshold", () => {
  const raid = loadRaid({
    ...baseRaid,
    // mt left at 100 (< TANK_HP=160) is hit; ot at full 160 is spared
    events: [
      { type: "set_hp", t: 1, name: "Damage", amount: 100, players: ["mt"] },
      whiteHoleAoe,
    ],
    players: roster(),
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(5.1 * 60));
  expect(byId(world, "mt").alive).toBe(false);
  expect(byId(world, "ot").alive).toBe(true);
  expect(byId(world, "ot").hp).toBe(TANK_HP);
});

test("requireFullHp: invincible below-full player survives", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      { type: "set_hp", t: 1, name: "Damage", amount: 50, players: ["m1"] },
      whiteHoleAoe,
    ],
    players: roster({ m1: { spawn: [0, 0] } }),
  });
  // Toggle invincibility on m1 before the mechanic resolves.
  let world = tick(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 }, toggleInvincibility: true } }, 1 / 60);
  expect(human(world).invincible).toBe(true);
  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(5.1 * 60));
  expect(human(world).alive).toBe(true);
});

