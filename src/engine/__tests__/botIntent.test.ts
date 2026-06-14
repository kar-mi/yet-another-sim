import { expect, test } from "bun:test";
import { computeBotIntents } from "../botIntent";
import { tick } from "../sim";
import { createWorld } from "../world";
import { applyBotPatterns, loadBotPatterns } from "../raidLoader";
import type { World } from "@shared/types";
import { HUMAN, baseRaid, effect, loadRaid, roster, runTicksWithBotIntents, runTicksWithComputedBotIntents, withControl, withEffect, withPlayerEffect } from "./helpers";

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

test("bot patterns can carry generic plant solver rules", () => {
  const raid = loadRaid(baseRaid);
  const botPatterns = loadBotPatterns({
    players: {},
    solvers: {
      generic: [
        { when: { plant: "down down", plantSlot: 0 }, spot: [18, 0] },
        { when: { plant: "down down", plantSlot: 1 }, spot: [0, 18] },
      ],
    },
  });
  const world = createWorld(applyBotPatterns(raid, botPatterns));

  expect(world.botSolvers?.generic?.[0]?.when).toEqual({ plant: "down down", plantSlot: 0 });
  expect(world.botSolvers?.generic?.[1]?.spot).toEqual({ x: 0, z: 18 });
});

test("bot patterns can carry generic rules with soaks/partnerDebuff/frame", () => {
  const raid = loadRaid(baseRaid);
  const botPatterns = loadBotPatterns({
    players: {},
    solvers: {
      generic: [
        { when: { mechanic: "tower-odd", soaks: true, debuff: ["Stack Charge"], partnerDebuff: "Cone Charge" }, frame: "matched", spot: [8, 0] },
      ],
    },
  });
  const world = createWorld(applyBotPatterns(raid, botPatterns));

  expect(world.botSolvers?.generic?.[0]?.when).toEqual({ mechanic: "tower-odd", soaks: true, debuff: ["Stack Charge"], partnerDebuff: "Cone Charge" });
  expect(world.botSolvers?.generic?.[0]?.frame).toBe("matched");
  expect(world.botSolvers?.generic?.[0]?.spot).toEqual({ x: 8, z: 0 });
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
  // Structural, not time-coupled: the opener distributes the planned charges, and the closing
  // raidwide resolves after the last tower wave. Exact timestamps are intentionally not asserted.
  expect(byEventId("forsaken-raidwide")).toBeDefined();
  expect(byEventId("forsaken-charges")).toMatchObject({ initial: "plan" });
  const lastTowerResolve = Math.max(...raid.events.filter(e => e.type === "tower").map(e => e.t + e.telegraph));
  const endRaidwide = byEventId("forsaken-end-raidwide");
  expect(endRaidwide && "t" in endRaidwide && endRaidwide.t > lastTowerResolve).toBe(true);
  expect(effectResolverById("forsaken-stack-resolve")).toMatchObject({ effectName: "Stack Charge" });
  expect(effectResolverById("forsaken-cone-resolve")).toMatchObject({ effectName: "Cone Charge" });
  expect(effectResolverById("forsaken-defamation-resolve")).toMatchObject({ effectName: "Defamation Charge" });
  expect(world.partners.h1).toBe("mt"); // pairing maps built from optionals.combinations.pairings
  expect(Object.keys(world.initialCharges)).toHaveLength(8);
  expect(world.botSolvers?.generic).toHaveLength(24);
  expect(world.botSolvers?.generic?.[0]?.when).toEqual({ mechanic: "bait-1" });
  expect(world.botSolvers?.generic?.[0]?.frame).toEqual(["tower-3-left", "tower-3-right"]);
  expect(world.players.find(player => player.id === "h1")?.pattern?.[0]?.pos).toEqual({ x: 7.39, z: -1.3 });
  const towerEvents = raid.events.filter(event => event.type === "tower");
  expect(towerEvents).toHaveLength(16);
  // All towers sit on a consistent ring — distance from origin within 0.1 of each other.
  const distances = towerEvents.map(e => Math.hypot(e.pos[0], e.pos[1]));
  const maxDist = Math.max(...distances), minDist = Math.min(...distances);
  expect(maxDist - minDist).toBeLessThan(0.1);
  // Each unique position is used exactly twice (16 towers, 8 spots, one pair per spot).
  const posKeys = towerEvents.map(e => `${e.pos[0]},${e.pos[1]}`);
  const counts = new Map<string, number>();
  for (const k of posKeys) counts.set(k, (counts.get(k) ?? 0) + 1);
  expect(counts.size).toBe(8);
  expect([...counts.values()].every(n => n === 2)).toBe(true);
  expect(raid.events.some(event => event.type === "tower" && event.requiredRoles !== undefined)).toBe(false);
  expect(towerEvents.every(event => event.radius === 4)).toBe(true);
  expect(towerEvents.every(event => event.failureDamage === 999999)).toBe(true);
  expect(towerEvents.every(event => (
    event.visual?.fallingObject === "sphere"
    && event.visual?.cylinderThickness === 3.5
    && event.visual?.fallingObjectAlpha === 0.7
  ))).toBe(true);
  // One recovery heal per tower wave (8), scheduled after the wave's resolve — derived, not
  // hard-coded, so a timeline change doesn't break it.
  const towerWaveCount = new Set(towerEvents.map(e => e.t)).size;
  const heals = raid.events.filter(event => event.type === "heal");
  expect(heals).toHaveLength(towerWaveCount);
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
  // Derive each tower wave's resolve (t + telegraph) and parity from the raid itself so the
  // checks follow the authored timing — they must not need updating when the timeline shifts.
  // After an odd wave the soakers swap to the even set (0/4/4), after an even wave to the odd
  // set (2/3/3); we sample 0.2 s past each resolve.
  const waves = new Map<number, "tower-odd" | "tower-even">();
  for (const e of raid.events) {
    if (e.type !== "tower") continue;
    waves.set(e.t + e.telegraph, e.labels?.includes("tower-odd") ? "tower-odd" : "tower-even");
  }
  const checkpoints = [...waves.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([resolveAt, parity]) => [
      resolveAt + 0.2,
      parity === "tower-odd"
        ? { stack: 0, cone: 4, defamation: 4 }
        : { stack: 2, cone: 3, defamation: 3 },
    ] as [number, ReturnType<typeof countCharges>]);
  expect(checkpoints).toHaveLength(8);
  for (const [t, counts] of checkpoints) {
    world = runTicksWithComputedBotIntents(world, Math.ceil((t - world.time) * 60));
    expect(countCharges(world)).toEqual(counts);
  }

  // Full clear: no tower failures (failure logs a "hit" for the whole raid) and the all-bot
  // roster survives to the end — including the Clone Spread on the 4 closest at each All Ending.
  world = runTicksWithComputedBotIntents(world, Math.ceil((raid.duration - world.time) * 60));
  expect(world.log.some(entry => entry.mechanic.startsWith("Forsaken Tower") && entry.event === "hit")).toBe(false);
  expect(world.log.some(entry => entry.mechanic === "Clone Spread" && entry.event === "hit")).toBe(true);
  expect(world.players.map(p => `${p.id}:${p.alive}`)).toEqual(world.players.map(p => `${p.id}:true`));
});

test("generic solver moves bots during a labeled tower window using a rotated frame", () => {
  // Two towers form a frame whose north is their bisector ([0,5]+[5,0] -> [0.707, 0.707]).
  const tower = (id: string, pos: [number, number]) => ({
    type: "tower", id, t: 1, name: id, labels: ["wave"], telegraph: 5, pos,
    radius: 3, failureDamage: 0, failureDamageType: "true" as const,
  });
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [0, 0] }, m1: { spawn: [0, 15] } }),
    events: [tower("wave-left", [0, 5]), tower("wave-right", [5, 0])],
    botSolvers: { generic: [{ when: { mechanic: "wave" }, frame: "matched", spot: [0, 5] }] },
  });

  let world = createWorld(raid);
  world = tick(world, {}, 1.1);
  // Frame coord [0, 5] -> 5 * north -> +x and +z.
  const intent = computeBotIntents(world, 1 / 60).mt;
  expect(intent?.move.x).toBeGreaterThan(0);
  expect(intent?.move.z).toBeGreaterThan(0);
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
    solvers: { generic: [
      { when: { plant: "down down", plantSlot: 0 }, spot: [18, 0] },
      { when: { plant: "down down", plantSlot: 1 }, spot: [0, 18] },
    ] },
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
    solvers: { generic: [
      { when: { plant: "right right", plantSlot: 0 }, spot: [18, 0] },
      { when: { plant: "right right", plantSlot: 1 }, spot: [0, 18] },
    ] },
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
    solvers: { generic: [{ when: { plant: "down down" }, spot: [18, 0] }] },
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
    solvers: { generic: [{ when: { plant: "down down" }, spot: [18, 0] }] },
  });
  const world = withControl(withEffect(createWorld(applyBotPatterns(raid, botPatterns)), effect({
    name: "Plant",
    behavior: { kind: "plant", direction: [0, -1], distance: 8, radius: 3, armDelay: 3, duration: 10, tpDelay: 1 },
    plantSlot: 0,
  })), "m1", "human");

  expect(computeBotIntents(world, 1 / 60).m1).toBeUndefined();
});

test("forsaken towerRng produces different wave-1 positions across seeds and only uses canonical positions", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/forsaken.yaml").text()) as { players: Array<Record<string, unknown>> };
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/forsaken-bots.yaml").text());
  const raid = loadRaid({ ...raidData, players: raidData.players.map(player => ({ ...player, control: "bot" })) });
  const bots = loadBotPatterns(botData);
  const baseRaid = applyBotPatterns(raid, bots);

  // Canonical tower positions are all radius-8 points (within 0.01 tolerance).
  const CANONICAL_RADIUS = 8;

  const getWave1Positions = (seed: number) => {
    const world = createWorld(baseRaid, seed);
    const firstWaveT = Math.min(...world.pendingTowers.map(t => t.t)); // wave 1 = earliest tower, whatever its t
    return world.pendingTowers
      .filter(t => t.t === firstWaveT)
      .map(t => ({ x: t.pos.x, z: t.pos.z }));
  };

  const pos1 = getWave1Positions(1);
  const pos2 = getWave1Positions(2);

  // Positions must differ across seeds (RNG is actually varying).
  expect(JSON.stringify(pos1)).not.toBe(JSON.stringify(pos2));

  // All tower positions across several seeds must be canonical radius-8 positions.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const world = createWorld(baseRaid, seed);
    for (const tower of world.pendingTowers) {
      const radius = Math.hypot(tower.pos.x, tower.pos.z);
      expect(Math.abs(radius - CANONICAL_RADIUS)).toBeLessThan(0.1);
    }
  }
});

test("forsaken bots clear all towers across multiple seeds with towerRng and rng enabled", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/forsaken.yaml").text()) as { players: Array<Record<string, unknown>> };
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/forsaken-bots.yaml").text());
  const raid = loadRaid({ ...raidData, players: raidData.players.map(player => ({ ...player, control: "bot" })) });
  const bots = loadBotPatterns(botData);
  const baseRaid = applyBotPatterns(raid, bots);

  for (const seed of [1, 2, 3, 4, 5]) {
    let world = createWorld(baseRaid, seed);
    world = runTicksWithComputedBotIntents(world, Math.ceil(raid.duration * 60));
    const towerFailures = world.log.filter(entry => entry.mechanic.startsWith("Forsaken Tower") && entry.event === "hit");
    expect(towerFailures).toHaveLength(0);
    expect(world.players.map(p => `${p.id}:${p.alive}`)).toEqual(world.players.map(p => `${p.id}:true`));
  }
});

