import { expect, test } from "bun:test";
import { computeBotIntents } from "../botIntent";
import { tick } from "../sim";
import { createWorld } from "../world";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import type { Intents, StatusEffect, World } from "../../shared/types";

const baseRaid = {
  name: "Test",
  arena: { zones: [{ kind: "circle" as const, center: [0, 0] as [number, number], radius: 20 }] },
  duration: 10,
  players: [{ id: "p1", role: "dps" as const, spawn: [0, 0] as [number, number] }],
  events: [] as {
    t: number;
    name: string;
    telegraph: number;
    damage: number;
    shape: { kind: "circle"; center: [number, number]; radius: number };
  }[],
};

function runTicks(world: ReturnType<typeof createWorld>, intents: Intents, count: number) {
  let w = world;
  for (let i = 0; i < count; i++) w = tick(w, intents, 1 / 60);
  return w;
}

function runTicksWithBotIntents(world: ReturnType<typeof createWorld>, count: number) {
  let w = world;
  for (let i = 0; i < count; i++) {
    w = tick(w, { ...computeBotIntents(w, 1 / 60), p1: { move: { x: 0, z: 0 } } }, 1 / 60);
  }
  return w;
}

function withEffect(world: World, effect: StatusEffect): World {
  return {
    ...world,
    players: world.players.map(player => player.id === "p1"
      ? { ...player, effects: [...player.effects, effect] }
      : player),
  };
}

function effect(overrides: Partial<StatusEffect> = {}): StatusEffect {
  return {
    id: "effect-1",
    name: "Effect",
    kind: "debuff",
    appliedAt: 0,
    duration: 10,
    behavior: { kind: "none" },
    ...overrides,
  };
}

test("tick is deterministic", () => {
  const raid = loadRaid(baseRaid);
  const intents = { p1: { move: { x: 0.3, z: 0.7 } } };

  let w1 = createWorld(raid);
  let w2 = createWorld(raid);
  for (let i = 0; i < 200; i++) {
    w1 = tick(w1, intents, 1 / 60);
    w2 = tick(w2, intents, 1 / 60);
  }

  expect(JSON.stringify(w1)).toBe(JSON.stringify(w2));
});

test("world includes a deterministic boss", () => {
  const raid = loadRaid(baseRaid);
  const world = createWorld(raid);
  const next = tick(world, { p1: { move: { x: 0, z: 0 } } }, 1 / 60);

  expect(world.boss).toEqual({ id: "boss", pos: { x: 0, z: 0 }, hp: 1000, maxHp: 1000, radius: 3 });
  expect(next.boss).toEqual(world.boss);
});

test("bot intents are deterministic", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: [
      { id: "p1", role: "dps" as const, control: "human" as const, spawn: [0, 15] as [number, number] },
      {
        id: "p2",
        role: "tank" as const,
        control: "bot" as const,
        spawn: [0, 0] as [number, number],
        pattern: [
          { t: 0, pos: [10, 0] as [number, number] },
          { t: 1, pos: [10, 10] as [number, number] },
        ],
      },
    ],
  });

  let w1 = createWorld(raid);
  let w2 = createWorld(raid);
  for (let i = 0; i < 200; i++) {
    w1 = tick(w1, { ...computeBotIntents(w1, 1 / 60), p1: { move: { x: 0, z: 0 } } }, 1 / 60);
    w2 = tick(w2, { ...computeBotIntents(w2, 1 / 60), p1: { move: { x: 0, z: 0 } } }, 1 / 60);
  }

  expect(JSON.stringify(w1)).toBe(JSON.stringify(w2));
});

test("bot patterns can be loaded from a companion definition", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: [
      { id: "p1", role: "dps" as const, control: "human" as const, spawn: [0, 15] as [number, number] },
      { id: "p2", role: "tank" as const, control: "bot" as const, spawn: [0, 0] as [number, number] },
    ],
  });
  const botPatterns = loadBotPatterns({
    players: {
      p2: [{ t: 0, pos: [8, 0] }],
    },
  });
  const world = createWorld(applyBotPatterns(raid, botPatterns));

  expect(world.players.find(player => player.id === "p2")?.pattern).toEqual([{ t: 0, pos: { x: 8, z: 0 } }]);
});

test("bot with a pattern can dodge an AOE while a bot without one is hit", () => {
  const movingRaid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "TestAOE", telegraph: 1, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 5 } }],
    players: [
      { id: "p1", role: "dps" as const, control: "human" as const, spawn: [15, 0] as [number, number] },
      {
        id: "p2",
        role: "healer" as const,
        control: "bot" as const,
        spawn: [0, 0] as [number, number],
        pattern: [{ t: 0, pos: [8, 0] as [number, number] }],
      },
    ],
  });
  const standingRaid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "TestAOE", telegraph: 1, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 5 } }],
    players: [
      { id: "p1", role: "dps" as const, control: "human" as const, spawn: [15, 0] as [number, number] },
      { id: "p2", role: "healer" as const, control: "bot" as const, spawn: [0, 0] as [number, number] },
    ],
  });

  const movingWorld = runTicksWithBotIntents(createWorld(movingRaid), Math.ceil(5.1 * 60));
  const standingWorld = runTicksWithBotIntents(createWorld(standingRaid), Math.ceil(5.1 * 60));
  const movingBot = movingWorld.players.find(player => player.id === "p2")!;
  const standingBot = standingWorld.players.find(player => player.id === "p2")!;

  expect(movingBot.hp).toBe(100);
  expect(standingBot.hp).toBeLessThan(100);
});

test("simultaneous mechanics with the same name get unique ids", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      { t: 3, name: "MirrorAOE", telegraph: 2, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [-5, 0], radius: 3 } },
      { t: 3, name: "MirrorAOE", telegraph: 2, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [5, 0], radius: 3 } },
    ],
  });
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 0 } } }, Math.ceil(3.1 * 60));
  const ids = world.active.map(mechanic => mechanic.id);

  expect(world.active).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
});

test("player takes damage when inside AOE at resolve", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "TestAOE", telegraph: 2, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 10 } }],
    players: [{ id: "p1", role: "dps" as const, spawn: [0, 0] as [number, number] }],
  });
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 0 } } }, Math.ceil(5.1 * 60));
  expect(world.players[0].hp).toBeLessThan(100);
});

test("player survives when outside AOE at resolve", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "TestAOE", telegraph: 2, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 5 } }],
    players: [{ id: "p1", role: "dps" as const, spawn: [0, 15] as [number, number] }],
  });
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 0 } } }, Math.ceil(5.1 * 60));
  expect(world.players[0].hp).toBe(100);
});

test("physical vuln amplifies matching damage and is consumed", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      {
        t: 0.1,
        name: "Apply Vuln",
        telegraph: 0.01,
        damage: 0,
        damageType: "physical" as const,
        applyEffect: {
          name: "Physical Vulnerability",
          kind: "debuff" as const,
          duration: 10,
          behavior: { kind: "vuln" as const, damageType: "physical" as const, multiplier: 1.5 },
        },
        shape: { kind: "circle" as const, center: [0, 0] as [number, number], radius: 10 },
      },
      {
        t: 0.3,
        name: "Physical Hit",
        telegraph: 0.01,
        damage: 20,
        damageType: "physical" as const,
        shape: { kind: "circle" as const, center: [0, 0] as [number, number], radius: 10 },
      },
    ],
  });
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 0 } } }, Math.ceil(0.5 * 60));

  expect(world.players[0].hp).toBeCloseTo(70);
  expect(world.players[0].effects).toHaveLength(0);
});

test("vuln does not amplify mismatched or expired damage", () => {
  const magicalRaid = loadRaid({
    ...baseRaid,
    events: [
      {
        t: 0.1,
        name: "Apply Vuln",
        telegraph: 0.01,
        damage: 0,
        damageType: "physical" as const,
        applyEffect: {
          name: "Physical Vulnerability",
          kind: "debuff" as const,
          duration: 10,
          behavior: { kind: "vuln" as const, damageType: "physical" as const, multiplier: 1.5 },
        },
        shape: { kind: "circle" as const, center: [0, 0] as [number, number], radius: 10 },
      },
      {
        t: 0.3,
        name: "Magical Hit",
        telegraph: 0.01,
        damage: 20,
        damageType: "magical" as const,
        shape: { kind: "circle" as const, center: [0, 0] as [number, number], radius: 10 },
      },
    ],
  });
  const magicalWorld = runTicks(createWorld(magicalRaid), { p1: { move: { x: 0, z: 0 } } }, Math.ceil(0.5 * 60));

  expect(magicalWorld.players[0].hp).toBeCloseTo(80);
  expect(magicalWorld.players[0].effects).toHaveLength(1);

  const expiredRaid = loadRaid({
    ...baseRaid,
    events: [{
      t: 0.1,
      name: "Late Hit",
      telegraph: 1,
      damage: 20,
      damageType: "physical" as const,
      shape: { kind: "circle" as const, center: [0, 0] as [number, number], radius: 10 },
    }],
  });
  const expiredWorld = tick(withEffect(createWorld(expiredRaid), effect({
    name: "Expired Vulnerability",
    duration: 0.5,
    behavior: { kind: "vuln", damageType: "physical", multiplier: 2 },
  })), { p1: { move: { x: 0, z: 0 } } }, 1.2);

  expect(expiredWorld.players[0].hp).toBeCloseTo(80);
  expect(expiredWorld.players[0].effects).toHaveLength(0);
});

test("zero-damage matching mechanic does not consume vuln", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      {
        t: 0.1,
        name: "Apply Vuln",
        telegraph: 0.01,
        damage: 0,
        damageType: "physical" as const,
        applyEffect: {
          name: "Physical Vulnerability",
          kind: "debuff" as const,
          duration: 10,
          behavior: { kind: "vuln" as const, damageType: "physical" as const, multiplier: 1.5 },
        },
        shape: { kind: "circle" as const, center: [0, 0] as [number, number], radius: 10 },
      },
      {
        t: 0.3,
        name: "Zero Strike",
        telegraph: 0.01,
        damage: 0,
        damageType: "physical" as const,
        shape: { kind: "circle" as const, center: [0, 0] as [number, number], radius: 10 },
      },
      {
        t: 0.5,
        name: "Physical Hit",
        telegraph: 0.01,
        damage: 20,
        damageType: "physical" as const,
        shape: { kind: "circle" as const, center: [0, 0] as [number, number], radius: 10 },
      },
    ],
  });
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 0 } } }, Math.ceil(0.7 * 60));

  expect(world.players[0].hp).toBeCloseTo(70);
  expect(world.players[0].effects).toHaveLength(0);
});

test("pyretic damages player actions", () => {
  const pyretic = effect({ name: "Pyretic", behavior: { kind: "pyretic", dps: 10 } });
  const cases: Intents[] = [
    { p1: { move: { x: 1, z: 0 } } },
    { p1: { move: { x: 0, z: 0 }, jump: true } },
    { p1: { move: { x: 0, z: 0 }, sprint: true } },
  ];

  for (const intents of cases) {
    const world = tick(withEffect(createWorld(loadRaid(baseRaid)), pyretic), intents, 1);
    expect(world.players[0].hp).toBeCloseTo(90);
  }

  const idleWorld = tick(withEffect(createWorld(loadRaid(baseRaid)), pyretic), { p1: { move: { x: 0, z: 0 } } }, 1);
  expect(idleWorld.players[0].hp).toBeCloseTo(100);
});

test("freeze damages player inactivity", () => {
  const freeze = effect({ name: "Freeze", behavior: { kind: "freeze", dps: 10 } });
  const idleWorld = tick(withEffect(createWorld(loadRaid(baseRaid)), freeze), { p1: { move: { x: 0, z: 0 } } }, 1);
  expect(idleWorld.players[0].hp).toBeCloseTo(90);

  const cases: Intents[] = [
    { p1: { move: { x: 1, z: 0 } } },
    { p1: { move: { x: 0, z: 0 }, jump: true } },
    { p1: { move: { x: 0, z: 0 }, sprint: true } },
  ];
  for (const intents of cases) {
    const world = tick(withEffect(createWorld(loadRaid(baseRaid)), freeze), intents, 1);
    expect(world.players[0].hp).toBeCloseTo(100);
  }
});

test("continuous effects respect tick timing boundaries", () => {
  const newlyAppliedRaid = loadRaid({
    ...baseRaid,
    events: [{
      t: 0.1,
      name: "Apply Pyretic",
      telegraph: 0.1,
      damage: 0,
      damageType: "physical" as const,
      applyEffect: {
        name: "Pyretic",
        kind: "debuff" as const,
        duration: 10,
        behavior: { kind: "pyretic" as const, dps: 100 },
      },
      shape: { kind: "circle" as const, center: [0, 0] as [number, number], radius: 10 },
    }],
  });
  const newlyAppliedWorld = tick(createWorld(newlyAppliedRaid), { p1: { move: { x: 1, z: 0 } } }, 0.3);

  expect(newlyAppliedWorld.players[0].hp).toBeCloseTo(100);
  expect(newlyAppliedWorld.players[0].effects).toHaveLength(1);

  const expiringWorld = tick(withEffect(createWorld(loadRaid(baseRaid)), effect({
    name: "Short Pyretic",
    duration: 0.25,
    behavior: { kind: "pyretic", dps: 40 },
  })), { p1: { move: { x: 1, z: 0 } } }, 1);

  expect(expiringWorld.players[0].hp).toBeCloseTo(90);
  expect(expiringWorld.players[0].effects).toHaveLength(0);
});

test("status becomes wiped when lethal damage hits all players", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "OneShot", telegraph: 2, damage: 100, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 20 } }],
  });
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 0 } } }, Math.ceil(5.1 * 60));
  expect(world.status).toBe("wiped");
});

test("status becomes cleared when all mechanics resolved and time elapsed", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: [{ id: "p1", role: "dps" as const, spawn: [0, 15] as [number, number] }],
    events: [{ t: 3, name: "TestAOE", telegraph: 2, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 5 } }],
  });
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 0 } } }, Math.ceil(11 * 60));
  expect(world.status).toBe("cleared");
});

test("player falls and dies when walking off arena", () => {
  const raid = loadRaid(baseRaid);
  // Move toward +Z edge (arena radius 20, player starts at [0,0])
  const world = runTicks(createWorld(raid), { p1: { move: { x: 0, z: 1 } } }, Math.ceil(3 * 60));
  expect(world.players[0].alive).toBe(false);
  const fellEntries = world.log.filter(e => e.event === "fell");
  expect(fellEntries.length).toBeGreaterThan(0);
});

test("player jumps and lands back on the ground", () => {
  const raid = loadRaid(baseRaid);
  let world = createWorld(raid);

  world = tick(world, { p1: { move: { x: 0, z: 0 }, jump: true } }, 1 / 60);
  expect(world.players[0].y).toBeGreaterThan(0);
  expect(world.players[0].verticalVelocity).toBeGreaterThan(0);

  world = runTicks(world, { p1: { move: { x: 0, z: 0 } } }, 60);
  expect(world.players[0].y).toBe(0);
  expect(world.players[0].verticalVelocity).toBe(0);
});

test("jumping does not avoid ground-targeted mechanics", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 0.1, name: "GroundAOE", telegraph: 0.01, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 10 } }],
  });
  let world = createWorld(raid);

  world = tick(world, { p1: { move: { x: 0, z: 0 }, jump: true } }, 1 / 60);
  world = runTicks(world, { p1: { move: { x: 0, z: 0 } } }, Math.ceil(0.2 * 60));

  expect(world.players[0].y).toBeGreaterThan(0);
  expect(world.players[0].hp).toBeLessThan(100);
});
