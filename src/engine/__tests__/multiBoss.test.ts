import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { loadRaid as loadRaidRaw } from "../raidLoader";
import { INITIAL_TANK_THREAT } from "@shared/constants";
import { baseRaid, byId, loadRaid, roster, runTicks } from "./helpers";

// ─── Schema ───────────────────────────────────────────────────────────────────

test("schema: single boss: form is accepted and normalizes to bosses[0]", () => {
  const raid = loadRaid({ ...baseRaid, events: [] });
  expect(raid.bosses).toHaveLength(1);
  expect(raid.bosses[0]!.id).toBe("boss");
});

test("schema: bosses: list form is accepted", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [
      { id: "chaos", pos: [-10, 0] },
      { id: "exdeath", pos: [10, 0] },
    ],
    events: [],
  });
  expect(raid.bosses).toHaveLength(2);
  expect(raid.bosses[0]!.id).toBe("chaos");
  expect(raid.bosses[1]!.id).toBe("exdeath");
});

test("schema: bosses: list with defaults fills in radius and ring", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [{ id: "chaos", pos: [-10, 0] }],
    events: [],
  });
  expect(raid.bosses[0]!.radius).toBe(3);
  expect(raid.bosses[0]!.ring.scale).toBe(2);
  expect(raid.bosses[0]!.ring.color).toBe("#e62120");
});

test("schema: rejects an event bossId that does not match any declared boss", () => {
  expect(() => loadRaidRaw({
    ...baseRaid,
    bosses: [{ id: "chaos", pos: [-10, 0] }],
    events: [
      {
        id: "bad-event",
        type: "aoe",
        t: 1,
        name: "Bad",
        telegraph: 1,
        damage: 10,
        damageType: "magical",
        shape: { kind: "circle", center: [0, 0], radius: 5 },
        bossId: "nonexistent",
      },
    ],
  })).toThrow(/bossId/);
});

test("schema: event bossId referencing a valid boss is accepted", () => {
  expect(() => loadRaidRaw({
    ...baseRaid,
    bosses: [{ id: "chaos", pos: [-10, 0] }, { id: "exdeath", pos: [10, 0] }],
    events: [
      {
        id: "cone-1",
        type: "aoe",
        t: 1,
        name: "Cone",
        telegraph: 1,
        damage: 10,
        damageType: "magical",
        shape: { kind: "circle", center: [0, 0], radius: 5 },
        bossId: "exdeath",
      },
    ],
  })).not.toThrow();
});

test("teleport_boss moves the named boss to an authored spot", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [{ id: "chaos", pos: [0, 0] }, { id: "kefka", pos: [0, 18], targetable: false }],
    events: [{
      id: "kefka-tp",
      type: "teleport_boss",
      t: 0,
      name: "Kefka Teleport",
      bossId: "kefka",
      rng: false,
      spots: [[18, 0], [0, -18]],
    }],
  });

  const world = runTicks(createWorld(raid), {}, 1);
  expect(world.bosses.find(b => b.id === "kefka")!.pos).toEqual({ x: 18, z: 0 });
  expect(world.pendingBossTeleports).toEqual([]);
});

test("schema: rejects a solver frame that references an undeclared boss", () => {
  expect(() => loadRaidRaw({
    ...baseRaid,
    bosses: [{ id: "chaos", pos: [-10, 0] }],
    events: [],
    botSolvers: { generic: [{
      when: { debuff: "Headwind" },
      frame: [{ boss: { id: "exdeath", from: "facing" } }],
      spot: { r: 0, z: 5 },
    }] },
  })).toThrow(/solver frame boss id/);
});

test("schema: accepts a solver frame that references a declared boss", () => {
  expect(() => loadRaidRaw({
    ...baseRaid,
    bosses: [{ id: "chaos", pos: [-10, 0] }, { id: "exdeath", pos: [10, 0] }],
    events: [],
    botSolvers: { generic: [{
      when: { debuff: "Headwind" },
      frame: [{ boss: { id: "exdeath", from: "position" } }],
      spot: { r: 0, z: 5 },
    }] },
  })).not.toThrow();
});

test("schema: rejects a solver origin that references an undeclared boss", () => {
  expect(() => loadRaidRaw({
    ...baseRaid,
    bosses: [{ id: "chaos", pos: [-10, 0] }],
    events: [],
    botSolvers: { generic: [{
      when: { debuff: "Headwind" },
      frame: [{ boss: { id: "chaos", from: "facing" } }],
      origin: { boss: "exdeath" },
      spot: { r: 0, z: 5 },
    }] },
  })).toThrow(/solver origin boss id/);
});

// ─── World creation ───────────────────────────────────────────────────────────

test("createWorld: single-boss raid produces boss === bosses[0]", () => {
  const raid = loadRaid({ ...baseRaid, events: [] });
  const world = createWorld(raid);
  expect(world.bosses).toHaveLength(1);
  expect(world.boss).toBe(world.bosses[0]);
  expect(world.boss.id).toBe("boss");
});

test("createWorld: multi-boss raid produces N bosses each with independent threat tables", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [
      { id: "chaos", pos: [-10, 0] },
      { id: "exdeath", pos: [10, 0] },
    ],
    events: [],
  });
  const world = createWorld(raid);
  expect(world.bosses).toHaveLength(2);
  expect(world.boss).toBe(world.bosses[0]);

  const chaos = world.bosses[0]!;
  const exdeath = world.bosses[1]!;
  // Each boss has its own threat table (separate objects, same initial values)
  expect(chaos.threat).not.toBe(exdeath.threat);
  expect(chaos.threat.mt).toBe(INITIAL_TANK_THREAT);
  expect(exdeath.threat.mt).toBe(INITIAL_TANK_THREAT);
  // Both start targeting mt (top threat from INITIAL_TANK_THREAT seed)
  expect(chaos.currentTarget).toBe("mt");
  expect(exdeath.currentTarget).toBe("mt");
});

test("createWorld: per-boss aggro seed makes boss face a specific tank", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [
      { id: "chaos", pos: [-10, 0], aggro: "mt" },
      { id: "exdeath", pos: [10, 0], aggro: "ot" },
    ],
    events: [],
  });
  const world = createWorld(raid);
  expect(world.bosses[0]!.currentTarget).toBe("mt");
  expect(world.bosses[1]!.currentTarget).toBe("ot");
});

// ─── Tick: independent facing ─────────────────────────────────────────────────

test("tick: each boss faces its own current target independently", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [
      { id: "chaos", pos: [-10, 0], aggro: "mt" },
      { id: "exdeath", pos: [10, 0], aggro: "ot" },
    ],
    players: roster({ mt: { spawn: [-12, 8] }, ot: { spawn: [12, 8] } }),
    events: [],
  });
  const world = runTicks(createWorld(raid), {}, 5);

  const chaos = world.bosses.find(b => b.id === "chaos")!;
  const exdeath = world.bosses.find(b => b.id === "exdeath")!;
  expect(chaos.currentTarget).toBe("mt");
  expect(exdeath.currentTarget).toBe("ot");
  // Bosses face different directions since their targets are on opposite sides of the arena.
  expect(chaos.facing).not.toBe(exdeath.facing);
});

// ─── Tick: bossId-anchored AOE uses the correct boss ─────────────────────────

test("tick: bossId-anchored cone snapshots the named boss's position, not the primary", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [
      { id: "primary", pos: [0, 0] },
      { id: "secondary", pos: [10, 0] },
    ],
    events: [
      {
        id: "secondary-cone",
        type: "aoe",
        t: 1,
        name: "Secondary Cone",
        telegraph: 1,
        damage: 50,
        damageType: "magical" as const,
        shape: { kind: "cone", angleDeg: 90, length: 10 },
        anchor: "boss",
        directionFrom: "bossFacing",
        bossId: "secondary",
      },
    ],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(1.01 * 60));
  const promoted = world.active.find(m => m.id === "secondary-cone");
  const secondary = world.bosses.find(b => b.id === "secondary")!;
  const primary = world.bosses.find(b => b.id === "primary")!;
  expect(promoted).toBeDefined();
  if (promoted && promoted.shape.kind === "cone") {
    // Origin should be the secondary boss's live position, not the primary boss's position.
    expect(promoted.shape.origin.x).toBeCloseTo(secondary.pos.x);
    expect(promoted.shape.origin.z).toBeCloseTo(secondary.pos.z);
    expect(Math.hypot(promoted.shape.origin.x - primary.pos.x, promoted.shape.origin.z - primary.pos.z)).toBeGreaterThan(1);
  }
});

// ─── Tick: bossId targeted aggro uses the named boss's target ─────────────────

test("tick: targeted aggro with bossId hits that boss's current target", () => {
  const raid = loadRaidRaw({
    ...baseRaid,
    bosses: [
      { id: "chaos", pos: [-10, 0], aggro: "mt" },
      { id: "exdeath", pos: [10, 0], aggro: "ot" },
    ],
    players: roster({ mt: { spawn: [-12, 0] }, ot: { spawn: [12, 0] } }),
    events: [
      {
        id: "exdeath-buster",
        type: "targeted",
        t: 1,
        name: "Exdeath Buster",
        targetMode: "aggro",
        radius: 4,
        telegraph: 1,
        damage: 50,
        damageType: "physical" as const,
        showCastBar: false,
        bossId: "exdeath",
      },
    ],
  });
  // ot is near [12, 0]; mt is at [-12, 0]. Exdeath targets ot (its aggro seed).
  const world = runTicks(createWorld(raid), {}, Math.ceil(2.1 * 60));
  const mt = world.players.find(p => p.id === "mt")!;
  const ot = world.players.find(p => p.id === "ot")!;
  // ot should have taken damage from exdeath's buster; mt should not.
  expect(ot.hp).toBeLessThan(ot.maxHp);
  expect(mt.hp).toBe(mt.maxHp);
});

test("tick: targeted closest with bossId measures from that boss", () => {
  const raid = loadRaid({
    ...baseRaid,
    bosses: [
      { id: "chaos", pos: [0, 0] },
      { id: "exdeath", pos: [10, 0] },
    ],
    players: roster({
      mt: { spawn: [0, 0] },
      ot: { spawn: [10, 1] },
    }),
    events: [{
      type: "targeted",
      id: "closest-exdeath",
      t: 0,
      name: "Closest Exdeath",
      bossId: "exdeath",
      targetMode: "closest",
      radius: 1,
      telegraph: 0.1,
      damage: 50,
      damageType: "magical",
    }],
  });

  const world = runTicks(createWorld(raid), {}, 20);

  expect(byId(world, "mt").hp).toBe(160);
  expect(byId(world, "ot").hp).toBe(110);
});
