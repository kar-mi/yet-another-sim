import { expect, test } from "bun:test";
import { computeBotIntents } from "../botIntent";
import { tick, DEATH_FLOOR_Y } from "../sim";
import { createWorld } from "../world";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import { CLOCK_SPOTS, ROSTER } from "../../shared/protocol";
import type { Intents, Player, StatusEffect, World } from "../../shared/types";

// The default human-controlled slot used across these tests (a dps).
const HUMAN = "m1";

type Vec = [number, number];
type Override = { spawn?: Vec; control?: "human" | "bot"; pattern?: { t: number; pos: Vec }[] };

// Build the canonical roster (mt, ot, h1, h2, r1, r2, m1, m2) at clock spots, with per-id overrides.
function roster(over: Record<string, Override> = {}) {
  return ROSTER.map(({ id, role }) => {
    const o = over[id] ?? {};
    return {
      id,
      role,
      control: o.control ?? (id === HUMAN ? "human" : "bot"),
      spawn: o.spawn ?? (CLOCK_SPOTS[id] as Vec),
      ...(o.pattern ? { pattern: o.pattern } : {}),
    };
  });
}

const baseRaid = {
  name: "Test",
  arena: { zones: [{ kind: "circle" as const, center: [0, 0] as Vec, radius: 20 }] },
  duration: 10,
  players: roster(),
  events: [] as unknown[],
};

function runTicks(world: ReturnType<typeof createWorld>, intents: Intents, count: number) {
  let w = world;
  for (let i = 0; i < count; i++) w = tick(w, intents, 1 / 60);
  return w;
}

function runTicksWithBotIntents(world: ReturnType<typeof createWorld>, count: number) {
  let w = world;
  for (let i = 0; i < count; i++) {
    w = tick(w, { ...computeBotIntents(w, 1 / 60), [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);
  }
  return w;
}

function withEffect(world: World, effect: StatusEffect): World {
  return {
    ...world,
    players: world.players.map(player => player.id === HUMAN
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

const human = (world: World) => world.players.find(p => p.id === HUMAN)!;

test("tick is deterministic", () => {
  const raid = loadRaid(baseRaid);
  const intents = { [HUMAN]: { move: { x: 0.3, z: 0.7 } } };

  let w1 = createWorld(raid);
  let w2 = createWorld(raid);
  for (let i = 0; i < 200; i++) {
    w1 = tick(w1, intents, 1 / 60);
    w2 = tick(w2, intents, 1 / 60);
  }

  expect(JSON.stringify(w1)).toBe(JSON.stringify(w2));
});

test("facing tracks movement direction and persists while idle", () => {
  const raid = loadRaid(baseRaid);
  const world = createWorld(raid);

  const movedX = tick(world, { [HUMAN]: { move: { x: 1, z: 0 } } }, 1 / 60);
  expect(human(movedX).facing).toBeCloseTo(Math.atan2(1, 0));

  const movedZ = tick(movedX, { [HUMAN]: { move: { x: 0, z: 1 } } }, 1 / 60);
  expect(human(movedZ).facing).toBeCloseTo(0);

  const idle = tick(movedZ, { [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);
  expect(human(idle).facing).toBeCloseTo(human(movedZ).facing);
});

test("world includes a deterministic boss", () => {
  const raid = loadRaid(baseRaid);
  const world = createWorld(raid);
  const next = tick(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);

  expect(world.boss).toEqual({ id: "boss", pos: { x: 0, z: 0 }, hp: 1000, maxHp: 1000, radius: 3 });
  expect(next.boss).toEqual(world.boss);
});

test("bot intents are deterministic", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({
      m1: { spawn: [0, 15] },
      mt: { control: "bot", spawn: [0, 0], pattern: [{ t: 0, pos: [10, 0] }, { t: 1, pos: [10, 10] }] },
    }),
  });

  let w1 = createWorld(raid);
  let w2 = createWorld(raid);
  for (let i = 0; i < 200; i++) {
    w1 = tick(w1, { ...computeBotIntents(w1, 1 / 60), [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);
    w2 = tick(w2, { ...computeBotIntents(w2, 1 / 60), [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);
  }

  expect(JSON.stringify(w1)).toBe(JSON.stringify(w2));
});

test("bot patterns can be loaded from a companion definition", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 15] }, mt: { control: "bot", spawn: [0, 0] } }),
  });
  const botPatterns = loadBotPatterns({
    players: {
      mt: [{ t: 0, pos: [8, 0] }],
    },
  });
  const world = createWorld(applyBotPatterns(raid, botPatterns));

  expect(world.players.find(player => player.id === "mt")?.pattern).toEqual([{ t: 0, pos: { x: 8, z: 0 } }]);
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

test("simultaneous mechanics with the same name get unique ids", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      { t: 3, name: "MirrorAOE", telegraph: 2, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [-5, 0], radius: 3 } },
      { t: 3, name: "MirrorAOE", telegraph: 2, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [5, 0], radius: 3 } },
    ],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(3.1 * 60));
  const ids = world.active.map(mechanic => mechanic.id);

  expect(world.active).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
});

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
  expect(human(world).hp).toBe(100);
});

test("toggleInvincibility intent flips the flag", () => {
  const world0 = createWorld(loadRaid(baseRaid));
  expect(human(world0).invincible).toBe(false);
  const world1 = tick(world0, { [HUMAN]: { move: { x: 0, z: 0 }, toggleInvincibility: true } }, 1 / 60);
  expect(human(world1).invincible).toBe(true);
  const world2 = tick(world1, { [HUMAN]: { move: { x: 0, z: 0 }, toggleInvincibility: true } }, 1 / 60);
  expect(human(world2).invincible).toBe(false);
});

test("invincible player takes no damage and cannot die in an AOE", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "LethalAOE", telegraph: 2, damage: 999, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 10 } }],
    players: roster({ m1: { spawn: [0, 0] } }),
  });
  // Toggle invincibility on with a single intent, then idle through the AOE resolve.
  let world = tick(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 }, toggleInvincibility: true } }, 1 / 60);
  expect(human(world).invincible).toBe(true);
  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(5.1 * 60));
  expect(human(world).hp).toBe(100);
  expect(human(world).alive).toBe(true);
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
        shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 10 },
      },
      {
        t: 0.3,
        name: "Physical Hit",
        telegraph: 0.01,
        damage: 20,
        damageType: "physical" as const,
        shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 10 },
      },
    ],
  });
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(0.5 * 60));

  expect(human(world).hp).toBeCloseTo(70);
  expect(human(world).effects).toHaveLength(0);
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
        shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 10 },
      },
      {
        t: 0.3,
        name: "Magical Hit",
        telegraph: 0.01,
        damage: 20,
        damageType: "magical" as const,
        shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 10 },
      },
    ],
  });
  const magicalWorld = runTicks(createWorld(magicalRaid), { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(0.5 * 60));

  expect(human(magicalWorld).hp).toBeCloseTo(80);
  expect(human(magicalWorld).effects).toHaveLength(1);

  const expiredRaid = loadRaid({
    ...baseRaid,
    events: [{
      t: 0.1,
      name: "Late Hit",
      telegraph: 1,
      damage: 20,
      damageType: "physical" as const,
      shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 10 },
    }],
  });
  const expiredWorld = tick(withEffect(createWorld(expiredRaid), effect({
    name: "Expired Vulnerability",
    duration: 0.5,
    behavior: { kind: "vuln", damageType: "physical", multiplier: 2 },
  })), { [HUMAN]: { move: { x: 0, z: 0 } } }, 1.2);

  expect(human(expiredWorld).hp).toBeCloseTo(80);
  expect(human(expiredWorld).effects).toHaveLength(0);
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
        shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 10 },
      },
      {
        t: 0.3,
        name: "Zero Strike",
        telegraph: 0.01,
        damage: 0,
        damageType: "physical" as const,
        shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 10 },
      },
      {
        t: 0.5,
        name: "Physical Hit",
        telegraph: 0.01,
        damage: 20,
        damageType: "physical" as const,
        shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 10 },
      },
    ],
  });
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(0.7 * 60));

  expect(human(world).hp).toBeCloseTo(70);
  expect(human(world).effects).toHaveLength(0);
});

test("pyretic damages player actions", () => {
  const pyretic = effect({ name: "Pyretic", behavior: { kind: "pyretic", dps: 10 } });
  const cases: Intents[] = [
    { [HUMAN]: { move: { x: 1, z: 0 } } },
    { [HUMAN]: { move: { x: 0, z: 0 }, jump: true } },
    { [HUMAN]: { move: { x: 0, z: 0 }, sprint: true } },
  ];

  for (const intents of cases) {
    const world = tick(withEffect(createWorld(loadRaid(baseRaid)), pyretic), intents, 1);
    expect(human(world).hp).toBeCloseTo(90);
  }

  const idleWorld = tick(withEffect(createWorld(loadRaid(baseRaid)), pyretic), { [HUMAN]: { move: { x: 0, z: 0 } } }, 1);
  expect(human(idleWorld).hp).toBeCloseTo(100);
});

test("freeze damages player inactivity", () => {
  const freeze = effect({ name: "Freeze", behavior: { kind: "freeze", dps: 10 } });
  const idleWorld = tick(withEffect(createWorld(loadRaid(baseRaid)), freeze), { [HUMAN]: { move: { x: 0, z: 0 } } }, 1);
  expect(human(idleWorld).hp).toBeCloseTo(90);

  const cases: Intents[] = [
    { [HUMAN]: { move: { x: 1, z: 0 } } },
    { [HUMAN]: { move: { x: 0, z: 0 }, jump: true } },
    { [HUMAN]: { move: { x: 0, z: 0 }, sprint: true } },
  ];
  for (const intents of cases) {
    const world = tick(withEffect(createWorld(loadRaid(baseRaid)), freeze), intents, 1);
    expect(human(world).hp).toBeCloseTo(100);
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
      shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 10 },
    }],
  });
  const newlyAppliedWorld = tick(createWorld(newlyAppliedRaid), { [HUMAN]: { move: { x: 1, z: 0 } } }, 0.3);

  expect(human(newlyAppliedWorld).hp).toBeCloseTo(100);
  expect(human(newlyAppliedWorld).effects).toHaveLength(1);

  const expiringWorld = tick(withEffect(createWorld(loadRaid(baseRaid)), effect({
    name: "Short Pyretic",
    duration: 0.25,
    behavior: { kind: "pyretic", dps: 40 },
  })), { [HUMAN]: { move: { x: 1, z: 0 } } }, 1);

  expect(human(expiringWorld).hp).toBeCloseTo(90);
  expect(human(expiringWorld).effects).toHaveLength(0);
});

test("status becomes wiped when lethal damage hits all players", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "OneShot", telegraph: 2, damage: 100, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 20 } }],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(5.1 * 60));
  expect(world.status).toBe("wiped");
});

test("status becomes cleared when all mechanics resolved and time elapsed", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ t: 3, name: "TestAOE", telegraph: 2, damage: 50, damageType: "physical" as const, shape: { kind: "circle", center: [0, 0], radius: 5 } }],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(11 * 60));
  expect(world.status).toBe("cleared");
});

test("status does not become cleared for an empty raid", () => {
  const raid = loadRaid(baseRaid);
  const world = runTicks(createWorld(raid), {}, Math.ceil(11 * 60));
  expect(world.hasMechanics).toBe(false);
  expect(world.status).toBe("running");
});

test("player falls and dies when walking off arena", () => {
  const raid = loadRaid({ ...baseRaid, players: roster({ m1: { spawn: [0, 0] } }) });
  // Move toward +Z edge (arena radius 20, player starts at [0,0]), then fall past the death floor.
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 1 } } }, Math.ceil(6 * 60));
  expect(human(world).alive).toBe(false);
  const fellEntries = world.log.filter(e => e.event === "fell" && e.playerId === HUMAN);
  expect(fellEntries.length).toBeGreaterThan(0);
});

test("invincible player still dies when falling off the map (invincibility only blocks damage)", () => {
  const raid = loadRaid({ ...baseRaid, players: roster({ m1: { spawn: [0, 0] } }) });
  // Enable invincibility, then keep walking off the +Z edge (arena radius 20).
  let world = tick(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 1 }, toggleInvincibility: true } }, 1 / 60);
  expect(human(world).invincible).toBe(true);
  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 1 } } }, Math.ceil(6 * 60));
  expect(human(world).alive).toBe(false);
  expect(world.log.some(e => e.event === "fell" && e.playerId === HUMAN)).toBe(true);
});

test("player does not die instantly at the arena edge but starts falling", () => {
  const raid = loadRaid({ ...baseRaid, players: roster({ m1: { spawn: [0, 19.5] } }) });
  // Walk just past the +Z edge (radius 20) and fall for ~0.5s — should be airborne, not dead.
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 1 } } }, 30);
  expect(human(world).alive).toBe(true);
  expect(human(world).y).toBeLessThan(0);
  expect(human(world).y).toBeGreaterThan(DEATH_FLOOR_Y);
});

test("player dies only after falling past the death floor", () => {
  const raid = loadRaid({ ...baseRaid, players: roster({ m1: { spawn: [0, 19.5] } }) });
  let world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 1 } } }, 30);
  expect(human(world).alive).toBe(true); // still falling, above the death floor
  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 1 } } }, 90);
  expect(human(world).alive).toBe(false);
  expect(world.log.some(e => e.event === "fell" && e.playerId === HUMAN)).toBe(true);
});

test("player jumps out over the edge and back in without dying", () => {
  const raid = loadRaid({ ...baseRaid, players: roster({ m1: { spawn: [0, 18] } }) });
  let world = createWorld(raid);
  // Jump and move outward past the +Z edge while airborne.
  world = tick(world, { [HUMAN]: { move: { x: 0, z: 1 }, jump: true } }, 1 / 60);
  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 1 } } }, 22);
  expect(human(world).alive).toBe(true);
  // Move back over the zone before landing, then settle on the floor.
  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: -1 } } }, 22);
  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, 30);
  expect(human(world).alive).toBe(true);
  expect(human(world).y).toBe(0);
});

test("player jumps and lands back on the ground", () => {
  const raid = loadRaid(baseRaid);
  let world = createWorld(raid);

  world = tick(world, { [HUMAN]: { move: { x: 0, z: 0 }, jump: true } }, 1 / 60);
  expect(human(world).y).toBeGreaterThan(0);
  expect(human(world).verticalVelocity).toBeGreaterThan(0);

  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, 60);
  expect(human(world).y).toBe(0);
  expect(human(world).verticalVelocity).toBe(0);
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
    if (p.id !== HUMAN) expect(p.hp).toBe(100);
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
  expect(world.players.find(p => p.id === "m1")!.hp).toBe(100);
  expect(world.players.find(p => p.id === "mt")!.hp).toBe(100);
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
  expect(human(world).hp).toBe(100);
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

test("loadRaid rejects rosters that do not match the canonical order", () => {
  expect(() => loadRaid({ ...baseRaid, players: [{ id: "p1", role: "dps", spawn: [0, 0] }] })).toThrow();
  expect(() => loadRaid({ ...baseRaid, players: roster().slice(0, 7) })).toThrow();
  expect(() => loadRaid({ ...baseRaid, players: [...roster()].reverse() })).toThrow();
});

test("waymarks round-trip into the world", () => {
  const raid = loadRaid({
    ...baseRaid,
    waymarks: [{ mark: "A", pos: [1, 2] }, { mark: "3", pos: [-4, 5] }],
  });
  const world = createWorld(raid);
  expect(world.waymarks).toEqual([
    { mark: "A", pos: { x: 1, z: 2 } },
    { mark: "3", pos: { x: -4, z: 5 } },
  ]);
});

test("waymarks default to empty when omitted", () => {
  expect(createWorld(loadRaid(baseRaid)).waymarks).toEqual([]);
});

test("loadRaid rejects duplicate waymarks", () => {
  expect(() => loadRaid({ ...baseRaid, waymarks: [{ mark: "A", pos: [0, 0] }, { mark: "A", pos: [1, 1] }] })).toThrow();
});

const kbEvent = (knockback: Record<string, unknown>) => ({
  t: 0.1, name: "KB", telegraph: 0.01, damage: 0, damageType: "true" as const,
  shape: { kind: "circle", center: [0, 0], radius: 10 }, knockback,
});

test("knockback pushes a player horizontally away from the origin", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [2, 0] } }),
    events: [kbEvent({ distance: 10 })],
  });
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 60);
  const p = human(world);
  expect(p.pos.x).toBeGreaterThan(10); // pushed outward from x=2 by ~10
  expect(p.pos.z).toBeCloseTo(0);
  expect(p.y).toBe(0); // no vertical component
  expect(p.knockbackVelocity).toEqual({ x: 0, z: 0 }); // came to rest
});

test("knockup launches a player into an arc, then lands farther out", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [2, 0] } }),
    events: [kbEvent({ distance: 8, height: 5 })],
  });
  const mid = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 12);
  expect(human(mid).y).toBeGreaterThan(0); // airborne mid-flight

  const landed = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 90);
  expect(human(landed).y).toBe(0); // back on the floor
  expect(human(landed).pos.x).toBeGreaterThan(8); // 2 + ~8 horizontal travel
  expect(human(landed).knockbackVelocity).toEqual({ x: 0, z: 0 });
});

test("knockback ignores player input while it carries them", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [2, 0] } }),
    events: [kbEvent({ distance: 10 })],
  });
  // Player holds movement toward the origin (-x); should still be pushed outward (+x).
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: -1, z: 0 } } }, 30);
  expect(human(world).pos.x).toBeGreaterThan(5);
});

test("knockback can push a player off the arena to their death", () => {
  const raid = loadRaid({
    ...baseRaid,
    arena: { zones: [{ kind: "circle" as const, center: [0, 0] as Vec, radius: 5 }] },
    players: roster({ m1: { spawn: [2, 0] } }),
    events: [kbEvent({ distance: 30 })],
  });
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(3 * 60));
  expect(human(world).alive).toBe(false);
  expect(world.log.some(e => e.event === "fell" && e.playerId === HUMAN)).toBe(true);
});

test("knockback uses an explicit origin when provided", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] } }),
    // Shape is centered at the origin, but the knockback origin is at +x, so the player is pushed -x.
    events: [kbEvent({ distance: 8, origin: [5, 0] })],
  });
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 60);
  expect(human(world).pos.x).toBeLessThan(0);
});

test("knockback raids remain deterministic", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [2, 0] } }),
    events: [kbEvent({ distance: 10, height: 4 })],
  });
  const intents = { [HUMAN]: { move: { x: 0.2, z: 0.5 } } };
  let w1 = createWorld(raid);
  let w2 = createWorld(raid);
  for (let i = 0; i < 200; i++) {
    w1 = tick(w1, intents, 1 / 60);
    w2 = tick(w2, intents, 1 / 60);
  }
  expect(JSON.stringify(w1)).toBe(JSON.stringify(w2));
});

test("anti-knockback buff negates knockback displacement", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [2, 0] } }),
    events: [kbEvent({ distance: 10 })],
  });
  // Activate anti-KB on the first tick, then hold still through the resolve (~0.11s).
  let w = tick(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 }, antiKnockback: true } }, 1 / 60);
  w = runTicks(w, { [HUMAN]: { move: { x: 0, z: 0 } } }, 59);
  const p = human(w);
  expect(p.pos.x).toBeCloseTo(2); // not pushed
  expect(p.knockbackVelocity).toEqual({ x: 0, z: 0 });
});

// --- Chains ---------------------------------------------------------------
// A chain bonds two named players; at cast end (t=0.6) both gain "Chain Bond",
// and they have until expiry (t=5.6) to separate past breakDistance or both eat breakDamage.
const chainEvent = {
  type: "chain" as const,
  t: 0.1,
  name: "Test Chain",
  pairs: [["m1", "ot"]] as [string, string][],
  telegraph: 0.5,
  breakWindow: 5,
  breakDistance: 12,
  breakDamage: 40,
  damageType: "magical" as const,
  debuffName: "Chain Bond",
  showCastBar: true,
};

// m1 (the human) and ot start 1 unit apart; arena is roomy so the human can walk far.
const chainRaid = () => loadRaid({
  ...baseRaid,
  arena: { zones: [{ kind: "circle" as const, center: [0, 0] as Vec, radius: 30 }] },
  players: roster({ m1: { spawn: [0, 0] }, ot: { spawn: [1, 0] } }),
  events: [chainEvent],
});

const otPlayer = (world: World) => world.players.find(p => p.id === "ot")!;
const hasChainBond = (p: Player) => p.effects.some(e => e.name === "Chain Bond");

test("chain applies its debuff to both members at cast end", () => {
  const world = runTicks(createWorld(chainRaid()), {}, Math.ceil(0.7 * 60));
  expect(hasChainBond(human(world))).toBe(true);
  expect(hasChainBond(otPlayer(world))).toBe(true);
  expect(human(world).hp).toBe(100);
  expect(otPlayer(world).hp).toBe(100);
});

test("separating a chained pair past breakDistance breaks it with no damage", () => {
  // Human walks +x away from the stationary partner until the chain stretches past
  // (starting distance + breakDistance) and snaps; runs well before the expiry burst.
  const world = runTicks(createWorld(chainRaid()), { [HUMAN]: { move: { x: 1, z: 0 } } }, Math.ceil(3.0 * 60));
  expect(hasChainBond(human(world))).toBe(false);
  expect(hasChainBond(otPlayer(world))).toBe(false);
  expect(human(world).hp).toBe(100);
  expect(otPlayer(world).hp).toBe(100);
});

test("a chain left unbroken bursts both members once at expiry", () => {
  // Both stand still through the whole window (expires at 5.6); run past it.
  const world = runTicks(createWorld(chainRaid()), {}, Math.ceil(6.0 * 60));
  expect(human(world).hp).toBe(60); // 100 - 40, applied exactly once
  expect(otPlayer(world).hp).toBe(60);
  expect(hasChainBond(human(world))).toBe(false);
  expect(hasChainBond(otPlayer(world))).toBe(false);
});

test("chain raids remain deterministic", () => {
  const raid = chainRaid();
  const intents = { [HUMAN]: { move: { x: 0.3, z: 0 } } };
  let w1 = createWorld(raid);
  let w2 = createWorld(raid);
  for (let i = 0; i < 200; i++) {
    w1 = tick(w1, intents, 1 / 60);
    w2 = tick(w2, intents, 1 / 60);
  }
  expect(JSON.stringify(w1)).toBe(JSON.stringify(w2));
});

test("anti-knockback also negates knockup", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [2, 0] } }),
    events: [kbEvent({ distance: 8, height: 5 })],
  });
  let w = tick(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 }, antiKnockback: true } }, 1 / 60);
  w = runTicks(w, { [HUMAN]: { move: { x: 0, z: 0 } } }, 30);
  const p = human(w);
  expect(p.y).toBe(0); // never launched
  expect(p.pos.x).toBeCloseTo(2);
});

test("anti-knockback has a 5s duration and 120s cooldown", () => {
  const raid = loadRaid(baseRaid);
  let w = tick(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 }, antiKnockback: true } }, 1 / 60);
  let p = human(w);
  expect(p.antiKbActive).toBeGreaterThan(4.9);
  expect(p.antiKbCooldown).toBeGreaterThan(119);

  // After 5s the buff has expired but the cooldown is still running.
  w = runTicks(w, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(5.1 * 60));
  p = human(w);
  expect(p.antiKbActive).toBe(0);
  expect(p.antiKbCooldown).toBeGreaterThan(0);

  // Pressing again while on cooldown does nothing.
  w = tick(w, { [HUMAN]: { move: { x: 0, z: 0 }, antiKnockback: true } }, 1 / 60);
  expect(human(w).antiKbActive).toBe(0);
});
