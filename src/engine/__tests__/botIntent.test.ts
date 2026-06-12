import { expect, test } from "bun:test";
import { computeBotIntents } from "../botIntent";
import { tick } from "../sim";
import { createWorld } from "../world";
import { applyBotPatterns, loadBotPatterns } from "../raidLoader";
import type { World } from "../../shared/types";
import { HUMAN, baseRaid, effect, human, loadRaid, roster, runTicksWithBotIntents, runTicksWithComputedBotIntents, withControl, withEffect, withPlayerEffect } from "./helpers";

test("bot intents are deterministic", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({
      m1: { spawn: [0, 15] },
      mt: { spawn: [0, 0], pattern: [{ t: 0, pos: [10, 0] }, { t: 1, pos: [10, 10] }] },
    }),
  });

  let w1 = createWorld(raid, 1);
  let w2 = createWorld(raid, 1);
  for (let i = 0; i < 200; i++) {
    w1 = tick(w1, { ...computeBotIntents(w1, 1 / 60), [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);
    w2 = tick(w2, { ...computeBotIntents(w2, 1 / 60), [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);
  }

  expect(JSON.stringify(w1)).toBe(JSON.stringify(w2));
});

test("bot patterns can be loaded from a companion definition", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 15] }, mt: { spawn: [0, 0] } }),
  });
  const botPatterns = loadBotPatterns({
    players: {
      mt: [{ t: 0, pos: [8, 0] }],
    },
  });
  const world = createWorld(applyBotPatterns(raid, botPatterns));

  expect(world.players.find(player => player.id === "mt")?.pattern).toEqual([{ t: 0, pos: { x: 8, z: 0 } }]);
});

test("bot patterns can carry plant arrow solver placements", () => {
  const raid = loadRaid(baseRaid);
  const botPatterns = loadBotPatterns({
    players: {},
    solvers: {
      plantArrows: {
        placements: {
          "down down": [[18, 0], [0, 18]],
        },
      },
    },
  });
  const world = createWorld(applyBotPatterns(raid, botPatterns));

  expect(world.botSolvers?.plantArrows?.placements["down down"]).toEqual([{ x: 18, z: 0 }, { x: 0, z: 18 }]);
});

test("bot patterns can carry forsaken solver spots", () => {
  const raid = loadRaid(baseRaid);
  const botPatterns = loadBotPatterns({
    players: {},
    solvers: {
      forsaken: {
        towerWindows: [{ start: 1, end: 3, tower: 1 }],
        towerSpots: { mt: [[8, 0]] },
      },
    },
  });
  const world = createWorld(applyBotPatterns(raid, botPatterns));

  expect(world.botSolvers?.forsaken?.towerSpots.mt[0]).toEqual({ x: 8, z: 0 });
});

test("forsaken raid and bot companion content load", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/forsaken.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/forsaken-bots.yaml").text());
  const raid = loadRaid(raidData);
  const bots = loadBotPatterns(botData);
  const world = createWorld(applyBotPatterns(raid, bots), 1);
  const byEventId = (id: string) => raid.events.find(event => event.id === id);
  const effectResolverById = (id: string) => raid.events.find(event => event.type === "effect_resolver" && event.id === id);

  expect(raid.name).toBe("Forsaken");
  expect(raid.duration).toBe(118);
  expect(byEventId("forsaken-raidwide")).toMatchObject({ t: 3 });
  expect(byEventId("forsaken-assign")).toMatchObject({ t: 3 });
  expect(byEventId("forsaken-end-raidwide")).toMatchObject({ t: 109 });
  expect(effectResolverById("forsaken-stack-resolve")).toMatchObject({ effectName: "Stack Charge" });
  expect(effectResolverById("forsaken-cone-resolve")).toMatchObject({ effectName: "Cone Charge" });
  expect(effectResolverById("forsaken-defamation-resolve")).toMatchObject({ effectName: "Defamation Charge" });
  expect(world.forsakenPlan?.towerOrder.join("")).toBe("AAABBBBA");
  expect(world.botSolvers?.forsaken?.towerWindows).toHaveLength(8);
  expect(world.botSolvers?.forsaken?.towerWindows[0]).toEqual({ start: 9, end: 16, tower: 1 });
  expect(world.players.find(player => player.id === "h1")?.pattern?.[0]?.pos).toEqual({ x: 7.39, z: -1.3 });
  const towerEvents = raid.events.filter(event => event.type === "tower");
  expect(towerEvents).toHaveLength(16);
  expect(towerEvents.map(event => event.pos)).toEqual([
    [0, 7.25], [7.25, 0],
    [7.25, 7.25], [7.25, -7.25],
    [7.25, 0], [0, -7.25],
    [7.25, -7.25], [-7.25, -7.25],
    [0, -7.25], [-7.25, 0],
    [-7.25, -7.25], [-7.25, 7.25],
    [-7.25, 0], [0, 7.25],
    [-7.25, 7.25], [7.25, 7.25],
  ]);
  expect(raid.events.some(event => event.type === "tower" && event.requiredRoles !== undefined)).toBe(false);
  expect(towerEvents.every(event => event.radius === 3)).toBe(true);
  expect(towerEvents.every(event => event.failureDamage === 999999)).toBe(true);
  expect(towerEvents.every(event => (
    event.visual?.fallingObject === "sphere"
    && event.visual?.cylinderThickness === 3.5
    && event.visual?.fallingObjectAlpha === 0.7
  ))).toBe(true);
  expect(raid.events.filter(event => event.type === "heal").map(event => event.t)).toEqual([18, 29, 39, 49, 60, 71, 81, 91]);
});

test("forsaken tower swaps alternate odd and even debuff distributions", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/forsaken.yaml").text()) as { players: Array<Record<string, unknown>> };
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/forsaken-bots.yaml").text());
  const raid = loadRaid({
    ...raidData,
    players: raidData.players.map(player => ({ ...player, control: "bot" })),
  });
  const bots = loadBotPatterns(botData);
  const countCharges = (world: World) => {
    const counts = { stack: 0, cone: 0, defamation: 0 };
    for (const player of world.players) {
      for (const effect of player.effects) {
        if (effect.appliedAt + effect.duration <= world.time) continue;
        if (effect.name === "Stack Charge") counts.stack++;
        else if (effect.name === "Cone Charge") counts.cone++;
        else if (effect.name === "Defamation Charge") counts.defamation++;
      }
    }
    return counts;
  };

  let world = createWorld(applyBotPatterns(raid, bots), 1);
  // Towers resolve at 16/27/37/47/58/69/79/89; odd waves swap soakers to the even
  // set (0/4/4), even waves back to the odd set (2/3/3).
  const checkpoints: [number, ReturnType<typeof countCharges>][] = [
    [16.2, { stack: 0, cone: 4, defamation: 4 }],
    [27.2, { stack: 2, cone: 3, defamation: 3 }],
    [37.2, { stack: 0, cone: 4, defamation: 4 }],
    [47.2, { stack: 2, cone: 3, defamation: 3 }],
    [58.2, { stack: 0, cone: 4, defamation: 4 }],
    [69.2, { stack: 2, cone: 3, defamation: 3 }],
    [79.2, { stack: 0, cone: 4, defamation: 4 }],
    [89.2, { stack: 2, cone: 3, defamation: 3 }],
  ];
  for (const [t, counts] of checkpoints) {
    world = runTicksWithComputedBotIntents(world, Math.ceil((t - world.time) * 60));
    expect(countCharges(world)).toEqual(counts);
  }

  // Full clear: no tower failures (failure logs a "hit" for the whole raid) and the
  // all-bot roster survives to the end of the sequence.
  world = runTicksWithComputedBotIntents(world, Math.ceil((118 - world.time) * 60));
  expect(world.log.some(entry => entry.mechanic.startsWith("Forsaken Tower") && entry.event === "hit")).toBe(false);
  expect(world.players.map(p => `${p.id}:${p.alive}`)).toEqual(world.players.map(p => `${p.id}:true`));
});

test("forsaken solver moves bots during authored tower and bait windows", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [0, 0] }, m1: { spawn: [0, 15] } }),
    botSolvers: {
      forsaken: {
        towerWindows: [{ start: 1, end: 3, tower: 1 }],
        baitWindows: [{ start: 4, end: 5, index: 1 }],
        towerSpots: { mt: [[8, 0]] },
        baitSpots: { mt: [[-8, 0]] },
      },
    },
  });

  let world = createWorld(raid);
  world = tick(world, {}, 1.1);
  expect(computeBotIntents(world, 1 / 60).mt?.move.x).toBeGreaterThan(0);

  world = tick(world, {}, 3);
  expect(computeBotIntents(world, 1 / 60).mt?.move.x).toBeLessThan(0);
});

test("bot with a pattern can dodge an AOE while a bot without one is hit", () => {
  const aoe = { t: 3, name: "TestAOE", telegraph: 1, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 5 } };
  const movingRaid = loadRaid({
    ...baseRaid,
    events: [aoe],
    players: roster({ h1: { spawn: [0, 0], pattern: [{ t: 0, pos: [8, 0] }] } }),
  });
  const standingRaid = loadRaid({
    ...baseRaid,
    events: [aoe],
    players: roster({ h1: { spawn: [0, 0] } }),
  });

  const movingWorld = runTicksWithBotIntents(createWorld(movingRaid), Math.ceil(5.1 * 60));
  const standingWorld = runTicksWithBotIntents(createWorld(standingRaid), Math.ceil(5.1 * 60));
  const movingBot = movingWorld.players.find(player => player.id === "h1")!;
  const standingBot = standingWorld.players.find(player => player.id === "h1")!;

  expect(movingBot.hp).toBe(100);
  expect(standingBot.hp).toBeLessThan(100);
});

test("plant arrow solver moves bots toward the placement for their assigned combo", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [0, 0] } }),
    optionals: {
      combinations: {
        plant: {
          g1: { members: ["mt"], combos: [["down", "down"]] },
          g2: { members: ["r1"], combos: [["up", "up"]] },
        },
      },
    },
  });
  const botPatterns = loadBotPatterns({
    players: {},
    solvers: { plantArrows: { placements: { "down down": [[18, 0], [0, 18]] } } },
  });
  const world = withPlayerEffect(createWorld(applyBotPatterns(raid, botPatterns)), "mt", effect({
    name: "Plant",
    behavior: { kind: "plant", direction: [0, -1], distance: 8, radius: 3, armDelay: 3, duration: 10, tpDelay: 1 },
    plantSlot: 0,
  }));

  const intent = computeBotIntents(world, 1 / 60).mt;

  expect(intent.move.x).toBeGreaterThan(0);
  expect(intent.move.z).toBeCloseTo(0);
});

test("plant arrow solver uses the active plant slot for two-position combos", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [0, 0] } }),
    optionals: {
      combinations: {
        plant: {
          g1: { members: ["mt"], combos: [["right", "right"]] },
          g2: { members: ["r1"], combos: [["up", "up"]] },
        },
      },
    },
  });
  const botPatterns = loadBotPatterns({
    players: {},
    solvers: { plantArrows: { placements: { "right right": [[18, 0], [0, 18]] } } },
  });
  const world = withPlayerEffect(createWorld(applyBotPatterns(raid, botPatterns)), "mt", effect({
    name: "Plant (long)",
    behavior: { kind: "plant", direction: [1, 0], distance: 8, radius: 3, armDelay: 3, duration: 10, tpDelay: 1 },
    plantSlot: 1,
  }));

  const intent = computeBotIntents(world, 1 / 60).mt;

  expect(intent.move.x).toBeCloseTo(0);
  expect(intent.move.z).toBeGreaterThan(0);
});

test("plant arrow solver falls back to authored bot waypoints when no placement matches", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [0, 0], pattern: [{ t: 0, pos: [0, 8] }] } }),
    optionals: {
      combinations: {
        plant: {
          g1: { members: ["mt"], combos: [["up", "up"]] },
          g2: { members: ["r1"], combos: [["down", "down"]] },
        },
      },
    },
  });
  const botPatterns = loadBotPatterns({
    players: {},
    solvers: { plantArrows: { placements: { "down down": [18, 0] } } },
  });
  const world = withPlayerEffect(createWorld(applyBotPatterns(raid, botPatterns)), "mt", effect({
    name: "Plant",
    behavior: { kind: "plant", direction: [0, 1], distance: 8, radius: 3, armDelay: 3, duration: 10, tpDelay: 1 },
    plantSlot: 0,
  }));

  const intent = computeBotIntents(world, 1 / 60).mt;

  expect(intent.move.x).toBeCloseTo(0);
  expect(intent.move.z).toBeGreaterThan(0);
});

test("plant arrow solver does not move human-controlled players", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] } }),
    optionals: {
      combinations: {
        plant: {
          g1: { members: ["m1"], combos: [["down", "down"]] },
          g2: { members: ["r1"], combos: [["up", "up"]] },
        },
      },
    },
  });
  const botPatterns = loadBotPatterns({
    players: {},
    solvers: { plantArrows: { placements: { "down down": [18, 0] } } },
  });
  const world = withControl(withEffect(createWorld(applyBotPatterns(raid, botPatterns)), effect({
    name: "Plant",
    behavior: { kind: "plant", direction: [0, -1], distance: 8, radius: 3, armDelay: 3, duration: 10, tpDelay: 1 },
    plantSlot: 0,
  })), "m1", "human");

  expect(computeBotIntents(world, 1 / 60).m1).toBeUndefined();
});

