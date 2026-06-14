import { expect, test } from "bun:test";
import { computeBotIntents } from "../botIntent";
import { tick } from "../sim";
import { createWorld } from "../world";
import { applyBotPatterns, loadBotPatterns } from "../raidLoader";
import { HUMAN, baseRaid, byId, effect, human, loadRaid, noMove, roster, runTicks, runTicksWithBotIntents, withEffect, withPlayerEffect } from "./helpers";
import type { Vec } from "./helpers";

test("plant debuff order maps timers to combo slots independently", () => {
  const plantEvent = (name: string, duration: number) => ({
    t: 0,
    name,
    telegraph: 0.01,
    damage: 0,
    damageType: "magical" as const,
    applyEffect: {
      name,
      kind: "debuff" as const,
      duration,
      behavior: { kind: "plant" as const, direction: "option" as const, distance: 8, radius: 3, armDelay: 3, duration: 10, tpDelay: 1 },
    },
    shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 20 },
  });
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [0, 0] } }),
    optionals: {
      combinations: {
        plant: {
          debuffOrder: [1, 0],
          g1: { members: ["mt"], combos: [["right", "down"]] },
          g2: { members: ["r1"], combos: [["up", "up"]] },
        },
      },
    },
    events: [plantEvent("Plant (short)", 7), plantEvent("Plant (long)", 10)],
  });

  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 10);
  const mt = world.players.find(player => player.id === "mt")!;
  const short = mt.effects.find(e => e.name === "Plant (short)")!;
  const long = mt.effects.find(e => e.name === "Plant (long)")!;

  expect(short.plantSlot).toBe(1);
  expect(short.behavior.kind).toBe("plant");
  if (short.behavior.kind === "plant") expect(short.behavior.direction).toEqual([0, -1]);
  expect(long.plantSlot).toBe(0);
  expect(long.behavior.kind).toBe("plant");
  if (long.behavior.kind === "plant") expect(long.behavior.direction).toEqual([1, 0]);
});

test("applyEffects can shuffle plant timer order without changing combo slot order", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [0, 0] } }),
    optionals: {
      combinations: {
        plant: {
          debuffOrder: [1, 0],
          g1: { members: ["mt"], combos: [["right", "down"]] },
          g2: { members: ["r1"], combos: [["up", "up"]] },
        },
      },
    },
    events: [{
      t: 0,
      name: "Tele-Trouncing",
      telegraph: 0.01,
      damage: 0,
      damageType: "magical" as const,
      applyEffects: {
        order: "shuffle" as const,
        effects: [
          {
            name: "Plant (short)",
            kind: "debuff" as const,
            duration: 7,
            behavior: { kind: "plant" as const, direction: "option" as const, distance: 8, radius: 3, armDelay: 3, duration: 10, tpDelay: 1 },
          },
          {
            name: "Plant (long)",
            kind: "debuff" as const,
            duration: 10,
            behavior: { kind: "plant" as const, direction: "option" as const, distance: 8, radius: 3, armDelay: 3, duration: 10, tpDelay: 1 },
          },
        ],
      },
      shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 20 },
    }],
  });

  const firstDurations = new Set<number>();
  for (let seed = 1; seed <= 40; seed++) {
    const world = runTicks(createWorld(raid, seed), { [HUMAN]: { move: { x: 0, z: 0 } } }, 10);
    const effects = world.players.find(player => player.id === "mt")!.effects
      .filter(e => e.behavior.kind === "plant");

    expect(effects.map(e => e.plantSlot)).toEqual([1, 0]);
    expect(effects.map(e => e.duration).sort((a, b) => a - b)).toEqual([7, 10]);
    firstDurations.add(effects[0]!.duration);
  }
  expect(firstDurations).toEqual(new Set([7, 10]));
});

test("applyEffects can balance shuffled plant timer order across a hit list", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster(),
    optionals: {
      combinations: {
        plant: {
          debuffOrder: [1, 0],
          g1: { members: ["mt", "ot", "h1", "h2"], combos: [["right", "down"]] },
          g2: { members: ["r1", "r2", "m1", "m2"], combos: [["right", "down"]] },
        },
      },
    },
    events: [{
      t: 0,
      name: "Tele-Trouncing",
      telegraph: 0.01,
      damage: 0,
      damageType: "magical" as const,
      applyEffects: {
        order: "shuffleBalanced" as const,
        effects: [
          {
            name: "Plant (short)",
            kind: "debuff" as const,
            duration: 7,
            behavior: { kind: "plant" as const, direction: "option" as const, distance: 8, radius: 3, armDelay: 3, duration: 10, tpDelay: 1 },
          },
          {
            name: "Plant (long)",
            kind: "debuff" as const,
            duration: 10,
            behavior: { kind: "plant" as const, direction: "option" as const, distance: 8, radius: 3, armDelay: 3, duration: 10, tpDelay: 1 },
          },
        ],
      },
      shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 20 },
    }],
  });

  const mtFirstDurations = new Set<number>();
  for (let seed = 1; seed <= 40; seed++) {
    const world = runTicks(createWorld(raid, seed), { [HUMAN]: { move: { x: 0, z: 0 } } }, 10);
    const firstDurations = world.players.map(player => {
      const plants = player.effects.filter(e => e.behavior.kind === "plant");
      expect(plants.map(e => e.plantSlot)).toEqual([1, 0]);
      return plants[0]!.duration;
    });

    expect(firstDurations.filter(duration => duration === 7)).toHaveLength(4);
    expect(firstDurations.filter(duration => duration === 10)).toHaveLength(4);
    mtFirstDurations.add(firstDurations[0]!);
  }
  expect(mtFirstDurations).toEqual(new Set([7, 10]));
});

test("double trouble solver moves marked bots behind their role group", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [0, 0] }, r1: { spawn: [0, 0] } }),
    botSolvers: { generic: [
      { when: { debuff: "Double Trouble", role: "tank" }, startAt: 20, spot: [-7, 7] },
      { when: { debuff: "Double Trouble", role: "healer" }, startAt: 20, spot: [-7, 7] },
      { when: { debuff: "Double Trouble", role: "dps" }, startAt: 20, spot: [7, -7] },
    ] },
  });
  const doubleTrouble = effect({
    name: "Double Trouble",
    duration: 24,
    behavior: { kind: "doubleTrouble", radius: 3, damage: 70, damageType: "magical", knockbackDistance: 6 },
  });
  let world = withPlayerEffect(createWorld(raid), "mt", doubleTrouble);
  world = withPlayerEffect(world, "r1", { ...doubleTrouble, id: "effect-2" });
  expect(computeBotIntents(world, 1 / 60).mt).toBeUndefined();

  world = { ...world, time: 20 };
  const intents = computeBotIntents(world, 1 / 60);
  expect(intents.mt?.move?.x).toBeLessThan(0);
  expect(intents.mt?.move?.z).toBeGreaterThan(0);
  expect(intents.r1?.move?.x).toBeGreaterThan(0);
  expect(intents.r1?.move?.z).toBeLessThan(0);
});

test("plant arrow solver remains deterministic with seeded plant rng", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [0, 0] } }),
    optionals: {
      combinations: {
        plant: {
          rng: true,
          g1: { members: ["mt"], combos: [["down", "down"]] },
          g2: { members: ["r1"], combos: [["up", "up"]] },
        },
      },
    },
  });
  const botPatterns = loadBotPatterns({
    players: {},
    solvers: {
      generic: [
        { when: { plant: "down down", plantSlot: 0 }, spot: [18, 0] },
        { when: { plant: "down down", plantSlot: 1 }, spot: [0, 18] },
        { when: { plant: "up up", plantSlot: 0 }, spot: [-18, 0] },
        { when: { plant: "up up", plantSlot: 1 }, spot: [0, -18] },
      ],
    },
  });
  const plannedRaid = applyBotPatterns(raid, botPatterns);
  let w1 = withPlayerEffect(createWorld(plannedRaid, 4), "mt", effect({
    name: "Plant",
    behavior: { kind: "plant", direction: [0, -1], distance: 8, radius: 3, armDelay: 3, duration: 10, tpDelay: 1 },
    plantSlot: 0,
  }));
  let w2 = withPlayerEffect(createWorld(plannedRaid, 4), "mt", effect({
    name: "Plant",
    behavior: { kind: "plant", direction: [0, -1], distance: 8, radius: 3, armDelay: 3, duration: 10, tpDelay: 1 },
    plantSlot: 0,
  }));

  for (let i = 0; i < 120; i++) {
    w1 = tick(w1, { ...computeBotIntents(w1, 1 / 60), [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);
    w2 = tick(w2, { ...computeBotIntents(w2, 1 / 60), [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);
  }

  expect(JSON.stringify(w1)).toBe(JSON.stringify(w2));
});


test("plant combinations assign each player a per-slot heading from their group's pool", () => {
  const optionals = {
    combinations: {
      plant: {
        g1: { members: ["mt", "ot", "h1", "h2"], combos: [["up", "up"], ["down", "down"], ["left", "left"], ["right", "right"]] },
        g2: { members: ["r1", "r2", "m1", "m2"], combos: [["up", "right"], ["right", "down"], ["down", "left"], ["left", "up"]] },
      },
    },
  };
  const plantEvent = (name: string) => ({
    t: 0.1, name, telegraph: 0.1, damage: 0, damageType: "magical",
    applyEffect: { name, kind: "debuff", duration: 20, behavior: { kind: "plant", direction: [1, 0], distance: 8, armDelay: 3 } },
    shape: { kind: "circle", center: [0, 0], radius: 25 },
  });
  const raid = loadRaid({ ...baseRaid, optionals, events: [plantEvent("Plant A"), plantEvent("Plant B")] });
  const world = createWorld(raid, 7);
  const after = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(0.3 * 60));
  // Every player ends with both plants stamped with their planned headings, in slot order.
  for (const p of after.players) {
    const dirs = p.effects.filter(e => e.behavior.kind === "plant").map(e => (e.behavior as { direction: [number, number] }).direction);
    expect(dirs).toEqual(world.plantPlan[p.id]);
  }
  const supportPlans = ["mt", "ot", "h1", "h2"].map(id => JSON.stringify(world.plantPlan[id])).sort();
  const dpsPlans = ["r1", "r2", "m1", "m2"].map(id => JSON.stringify(world.plantPlan[id])).sort();
  expect(supportPlans).toEqual([
    JSON.stringify([[0, -1], [0, -1]]),
    JSON.stringify([[-1, 0], [-1, 0]]),
    JSON.stringify([[0, 1], [0, 1]]),
    JSON.stringify([[1, 0], [1, 0]]),
  ].sort());
  expect(dpsPlans).toEqual([
    JSON.stringify([[0, -1], [-1, 0]]),
    JSON.stringify([[-1, 0], [0, 1]]),
    JSON.stringify([[0, 1], [1, 0]]),
    JSON.stringify([[1, 0], [0, -1]]),
  ].sort());
});

const pairingsOptionals = {
  combinations: {
    pairings: {
      rng: false,
      patterns: [
        {
          id: "static",
          pairs: [
            { members: ["h1", "mt"], group: "A", charges: ["stack", "cone"] },
            { members: ["h2", "ot"], group: "B", charges: ["cone", "cone"] },
            { members: ["r1", "m1"], group: "A", charges: ["stack", "defamation"] },
            { members: ["r2", "m2"], group: "B", charges: ["defamation", "defamation"] },
          ],
        },
        {
          id: "alternate",
          pairs: [
            { members: ["h1", "mt"], group: "B", charges: ["cone", "cone"] },
            { members: ["h2", "ot"], group: "A", charges: ["stack", "cone"] },
            { members: ["r1", "m1"], group: "B", charges: ["defamation", "defamation"] },
            { members: ["r2", "m2"], group: "A", charges: ["cone", "defamation"] },
          ],
        },
      ],
    },
  },
};

test("pairing combinations build the generic pairing maps when rng is false", () => {
  const raid = loadRaid({ ...baseRaid, optionals: pairingsOptionals });
  const world = createWorld(raid, 1);

  // partners (paired player), playerGroups (each pair's declared group), and initialCharges (each
  // member's declared charge kind for the reassign opener).
  expect(world.partners.h1).toBe("mt");
  expect(world.partners.mt).toBe("h1");
  expect(world.initialCharges.h1).toBe("stack");
  expect(world.initialCharges.mt).toBe("cone");
  expect(world.playerGroups.h1).toBe("A");
  expect(world.playerGroups.h2).toBe("B");
});

test("pairing combinations are deterministic for the same seeded rng", () => {
  const raid = loadRaid({
    ...baseRaid,
    optionals: { combinations: { pairings: { ...pairingsOptionals.combinations.pairings, rng: true } } },
  });
  const a = createWorld(raid, 1);
  const b = createWorld(raid, 1);

  expect(a.initialCharges).toEqual(b.initialCharges);
  expect(a.playerGroups).toEqual(b.playerGroups);
  expect(a.partners).toEqual(b.partners);
});

test("reassign opener applies invisible charge and short head-marker effects from the plan", () => {
  const charge = (kind: string, name: string, markerIcon: string) => ({
    kind,
    effect: { name, kind: "debuff", duration: 20, visibility: "invisible", behavior: { kind: "none" } },
    marker: { name: `${name} Marker`, kind: "debuff", duration: 5, visibility: "invisible", markerIcon, behavior: { kind: "none" } },
  });
  const raid = loadRaid({
    ...baseRaid,
    optionals: pairingsOptionals,
    events: [{
      type: "reassign", id: "assign", t: 0, name: "Forsaken Assignment", initial: "plan",
      charges: [
        charge("stack", "Stack Charge", "stack_processed.png"),
        charge("cone", "Cone Charge", "cone_processed.png"),
        charge("defamation", "Defamation Charge", "defam_processed.png"),
      ],
    }],
  });
  const world = runTicks(createWorld(raid, 1), noMove, 1);
  const h1 = byId(world, "h1");

  expect(h1.effects.some(e => e.name === "Stack Charge" && e.visibility === "invisible" && e.marker === undefined)).toBe(true);
  expect(h1.effects.some(e => e.name === "Stack Charge Marker" && e.visibility === "invisible" && e.markerIcon === "stack_processed.png" && e.duration === 5)).toBe(true);
  // Past/Future is no longer a per-player debuff (it's each ending cone's directionOffset).
  expect(h1.effects.some(e => e.name.startsWith("Forsaken "))).toBe(false);
});

test("plant direction \"option\" parses to a concrete vector (overridden by the combination plan)", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{
      t: 1, name: "Plant", telegraph: 1, damage: 0, damageType: "magical",
      applyEffect: { name: "Plant", kind: "debuff", duration: 7, behavior: { kind: "plant", direction: "option", distance: 8 } },
      shape: { kind: "circle", center: [0, 0], radius: 25 },
    }],
  });
  const ev = raid.events[0] as Extract<typeof raid.events[number], { type?: "aoe" }>;
  const behavior = ev.applyEffect!.behavior as { kind: string; direction: [number, number] };
  expect(behavior.direction).toEqual([0, 1]); // "option" -> placeholder vector, not a string
});

test("plant combination groups keep their pools without rng, but randomize combo order", () => {
  const groups = {
    g1: { members: ["mt", "ot", "h1", "h2"], combos: [["up", "up"], ["down", "down"], ["left", "left"], ["right", "right"]] },
    g2: { members: ["r1", "r2", "m1", "m2"], combos: [["up", "right"], ["right", "down"], ["down", "left"], ["left", "up"]] },
  };
  const mk = (rng: boolean) => loadRaid({ ...baseRaid, optionals: { combinations: { plant: { rng, ...groups } } } });
  const supportPool = [
    JSON.stringify([[0, -1], [0, -1]]),
    JSON.stringify([[-1, 0], [-1, 0]]),
    JSON.stringify([[0, 1], [0, 1]]),
    JSON.stringify([[1, 0], [1, 0]]),
  ].sort();
  const fixed = mk(false);
  for (const seed of [1, 50, 123, 9999]) {
    const plan = createWorld(fixed, seed).plantPlan;
    expect(["mt", "ot", "h1", "h2"].map(id => JSON.stringify(plan[id])).sort()).toEqual(supportPool);
  }
  const fixedSeen = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => JSON.stringify(createWorld(fixed, s).plantPlan.mt)));
  expect(fixedSeen.size).toBeGreaterThan(1);

  // With rng, mt's selected pool can also vary across seeds.
  const rolled = mk(true);
  const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => JSON.stringify(createWorld(rolled, s).plantPlan.mt)));
  expect(seen.size).toBeGreaterThan(1);
});

test("plant debuff places a teleport trap that arms, then snaps the entrant after a windup", () => {
  const raid = loadRaid({ ...baseRaid, players: roster({ m1: { spawn: [0, 0] } }) });
  const world = withEffect(createWorld(raid), effect({
    name: "Plant",
    duration: 0.5,
    behavior: { kind: "plant", direction: [0, 1], distance: 8, radius: 3, armDelay: 0.5, duration: 10, tpDelay: 1 },
  }));
  // Debuff expires at 0.5; trap arms at 1.0. Before arming the placer is not teleported.
  const armed = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(0.8 * 60));
  expect(armed.forcedMarches.some(fm => fm.id.startsWith("plant-"))).toBe(true);
  expect(human(armed).pos.z).toBeLessThan(1); // trap inert
  // Captured at 1.0; during the 1s windup the player stays put at A (it's a teleport, not a slide).
  const windup = runTicks(armed, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(0.7 * 60));
  expect(human(windup).pos.z).toBeLessThan(1); // still at A mid-windup, not partway
  // After the windup (~2.0s) it teleports instantly to ~8 north.
  const after = runTicks(windup, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(1 * 60));
  expect(human(after).pos.z).toBeGreaterThan(6);
});

test("plant teleport lands the captured player along the direction from their own spot", () => {
  const raid = loadRaid({ ...baseRaid, players: roster({ m1: { spawn: [0, 0] } }) });
  let world = withEffect(createWorld(raid), effect({
    name: "Plant", duration: 0.5,
    behavior: { kind: "plant", direction: [0, 1], distance: 8, radius: 4, armDelay: 1, duration: 10, tpDelay: 0.3 },
  }));
  // Hold until the trap is placed (expiry 0.5) so it centers on [0, 0].
  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(0.5 * 60));
  // Drift +x off the trap center (but stay inside radius 4) before it arms at 1.5.
  world = runTicks(world, { [HUMAN]: { move: { x: 1, z: 0 } } }, Math.ceil(0.4 * 60));
  const offCenterX = human(world).pos.x;
  expect(offCenterX).toBeGreaterThan(1);
  // Arm + windup + teleport: lands `distance` north of the player's own spot, x unchanged.
  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(1.5 * 60));
  expect(human(world).pos.z).toBeGreaterThan(6);
  expect(human(world).pos.x).toBeCloseTo(offCenterX, 1);
});

test("plant teleport suppresses stale bot waypoints until the next authored waypoint", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({
      mt: {
        spawn: [0, 0],
        pattern: [{ t: 0, pos: [0, 0] }, { t: 3, pos: [0, 8] }],
      },
    }),
  });
  let world = withPlayerEffect(createWorld(raid), "mt", effect({
    name: "Plant", duration: 0.1,
    behavior: { kind: "plant", direction: [1, 0], distance: 6, radius: 4, armDelay: 0, duration: 10, tpDelay: 0.1 },
  }));

  world = runTicksWithBotIntents(world, Math.ceil(0.8 * 60));
  expect(world.players.find(p => p.id === "mt")!.pos.x).toBeGreaterThan(5);
  expect(computeBotIntents(world, 1 / 60).mt).toBeUndefined();

  world = runTicksWithBotIntents(world, Math.ceil(2.4 * 60));
  expect(computeBotIntents(world, 1 / 60).mt?.move?.z).toBeGreaterThan(0);
});

