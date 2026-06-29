import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { DPS_HP, HEALER_HP, TANK_HP } from "./constants";
import type { Intents } from "@shared/types";
import { HUMAN, baseRaid, byId, effect, human, loadRaid, roster, runTicks, withEffect } from "./helpers";
import type { Vec } from "./helpers";

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
  expect(human(world).hp).toBe(DPS_HP);
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

test("applyEffect can create an invisible debuff from any mechanic", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      {
        t: 0.1,
        name: "Invisible Debuff",
        telegraph: 0.01,
        damage: 0,
        damageType: "magical" as const,
        applyEffect: {
          name: "Stored Sentence",
          kind: "debuff" as const,
          duration: 10,
          visibility: "invisible" as const,
          markerIcon: "defam_processed.png",
          behavior: { kind: "none" as const },
        },
        shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 10 },
      },
    ],
  });

  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 20);
  expect(human(world).effects.some(e =>
    e.name === "Stored Sentence"
    && e.visibility === "invisible"
    && e.markerIcon === "defam_processed.png",
  )).toBe(true);
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

test("mitigation reduces repeated matching hits without being consumed", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      {
        t: 0.1,
        name: "Tank LB",
        telegraph: 0.01,
        damage: 0,
        damageType: "magical" as const,
        applyEffect: {
          name: "Tank LB",
          kind: "buff" as const,
          duration: 10,
          behavior: { kind: "mitigation" as const, damageType: "magical" as const, multiplier: 0.1 },
        },
        shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 10 },
      },
      {
        t: 0.3,
        name: "Magical Hit 1",
        telegraph: 0.01,
        damage: 20,
        damageType: "magical" as const,
        shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 10 },
      },
      {
        t: 0.5,
        name: "Magical Hit 2",
        telegraph: 0.01,
        damage: 20,
        damageType: "magical" as const,
        shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 10 },
      },
    ],
  });
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(0.7 * 60));

  expect(human(world).hp).toBeCloseTo(96);
  expect(human(world).effects.some(e => e.behavior.kind === "mitigation")).toBe(true);
});

test("pyretic damages player actions", () => {
  const pyretic = effect({ name: "Pyretic", behavior: { kind: "dot", dps: 10, condition: "moving" } });
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
  const freeze = effect({ name: "Freeze", behavior: { kind: "dot", dps: 10, condition: "idle" } });
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

test("dot condition \"always\" damages regardless of action", () => {
  const bleed = effect({ name: "Bleed", behavior: { kind: "dot", dps: 10, condition: "always" } });
  const idle = tick(withEffect(createWorld(loadRaid(baseRaid)), bleed), { [HUMAN]: { move: { x: 0, z: 0 } } }, 1);
  expect(human(idle).hp).toBeCloseTo(90);
  const moving = tick(withEffect(createWorld(loadRaid(baseRaid)), bleed), { [HUMAN]: { move: { x: 1, z: 0 } } }, 1);
  expect(human(moving).hp).toBeCloseTo(90);
});

test("apply_effect with no target hits all living players", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{
      type: "apply_effect", t: 0, name: "Mark",
      applyEffect: { name: "Mark", kind: "debuff", duration: 5, behavior: { kind: "none" } },
    }],
  });
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 2);
  for (const p of world.players) {
    expect(p.effects.some(e => e.name === "Mark")).toBe(true);
  }
});

test("apply_effect narrows by role and count", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{
      type: "apply_effect", t: 0, name: "Mark", role: "dps", count: 2,
      applyEffect: { name: "Mark", kind: "debuff", duration: 5, behavior: { kind: "none" } },
    }],
  });
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 2);
  const marked = world.players.filter(p => p.effects.some(e => e.name === "Mark"));
  expect(marked).toHaveLength(2);
  expect(marked.every(p => p.role === "dps")).toBe(true);
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
        behavior: { kind: "dot" as const, dps: 100, condition: "moving" as const },
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
    behavior: { kind: "dot", dps: 40, condition: "moving" },
  })), { [HUMAN]: { move: { x: 1, z: 0 } } }, 1);

  expect(human(expiringWorld).hp).toBeCloseTo(90);
  expect(human(expiringWorld).effects).toHaveLength(0);
});


test("effect_burst drops an AOE on each carrier of the named effect", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] }, m2: { spawn: [3, 0] }, mt: { spawn: [18, 0] } }),
    events: [{ type: "effect_burst", t: 0.5, name: "Sleeper Burst", telegraph: 0.5, effectName: "Sleep", radius: 5, damage: 50, damageType: "magical" }],
  });
  const world = withEffect(createWorld(raid), effect({ name: "Sleep", duration: 20, behavior: { kind: "sleep" } }));
  const after = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(1.2 * 60));
  expect(human(after).hp).toBeLessThan(100); // m1 carries Sleep -> burst centered on it
  expect(after.players.find(p => p.id === "m2")!.hp).toBeLessThan(100); // within radius of the carrier
  expect(after.players.find(p => p.id === "mt")!.hp).toBe(TANK_HP); // far away, untouched
});

test("effect_select can apply double trouble, which expires into damage and knockback around the carrier", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [0, 0] }, ot: { spawn: [2, 0] }, h1: { spawn: [5, 0] } }),
    events: [{
      type: "effect_select", t: 0, name: "Double Trouble", groups: [["mt"]],
      applyEffect: {
        name: "Double Trouble", kind: "debuff", duration: 0.1,
        behavior: { kind: "burstSpread", radius: 3, damage: 10, damageType: "magical", knockbackDistance: 6 },
      },
    }],
  });

  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 45);
  const mt = world.players.find(p => p.id === "mt")!;
  const ot = world.players.find(p => p.id === "ot")!;
  const h1 = world.players.find(p => p.id === "h1")!;

  expect(mt.hp).toBe(TANK_HP - 10);
  expect(ot.hp).toBe(TANK_HP - 10);
  expect(h1.hp).toBe(HEALER_HP);
  expect(mt.pos.x).toBeCloseTo(0);
  expect(ot.pos.x).toBeGreaterThan(2);
});

// --- Assignment ---

test("assignment debuff deals expiryDamage on expiry tick, nothing before", () => {
  const assignEffect = effect({
    id: "assign-1",
    name: "First in Line",
    appliedAt: 0,
    duration: 1,
    behavior: { kind: "assignment" as const, expiryDamage: 30, expiryDamageType: "true" as const },
  });
  const world = withEffect(createWorld(loadRaid(baseRaid)), assignEffect);
  // Before expiry: no damage.
  const before = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(0.5 * 60));
  expect(human(before).hp).toBe(DPS_HP);
  // After expiry: expiryDamage applied.
  const after = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil(2 * 60));
  expect(human(after).hp).toBe(DPS_HP - 30);
});

test("apply_effect with explicit players lands assignment on exactly those players", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{
      type: "apply_effect", t: 0, name: "First in Line", players: ["mt", "ot"],
      applyEffect: {
        name: "First in Line", kind: "debuff", duration: 5,
        behavior: { kind: "assignment", expiryDamage: 10, expiryDamageType: "true" },
        icon: "first_in_line.png", marker: "1",
      },
    }],
  });
  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 2);
  const withMark = world.players.filter(p => p.effects.some(e => e.name === "First in Line"));
  expect(withMark).toHaveLength(2);
  expect(withMark.map(p => p.id).sort()).toEqual(["mt", "ot"]);
});

test("applyEffect ref resolves with nested behavior overrides", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{
      type: "apply_effect", t: 0, name: "Vuln", players: [HUMAN],
      applyEffect: { ref: "magic_vulnerability", duration: 6, behavior: { multiplier: 1.25 } },
    }],
  });
  const event = raid.events.find(e => e.type === "apply_effect")!;
  const behavior = event.applyEffect!.behavior;
  expect(event.applyEffect!.duration).toBe(6);
  expect(behavior).toEqual({ kind: "vuln", damageType: "magical", multiplier: 1.25 });
});

test("applyEffect ref resolves buffs", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{
      type: "apply_effect", t: 0, name: "Tank LB", players: [HUMAN],
      applyEffect: { ref: "tank_limit_break" },
    }],
  });
  const event = raid.events.find(e => e.type === "apply_effect")!;
  expect(event.applyEffect).toMatchObject({
    name: "Tank Limit Break",
    kind: "buff",
    duration: 10,
    behavior: { kind: "mitigation", multiplier: 0.1 },
  });
});

test("applyEffect ref must be a snake_case id", () => {
  expect(() => loadRaid({
    ...baseRaid,
    events: [{
      type: "apply_effect", t: 0, name: "Vuln",
      applyEffect: { ref: "Magic Vulnerability" },
    }],
  })).toThrow(/snake_case/);
});

test("assignment-test demo raid loads without error", async () => {
  const text = await Bun.file(`${import.meta.dir}/../../../raids/debug/assignment-test.yaml`).text();
  const yaml = Bun.YAML.parse(text);
  expect(() => loadRaid(yaml)).not.toThrow();
});
