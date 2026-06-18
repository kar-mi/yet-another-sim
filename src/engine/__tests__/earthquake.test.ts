import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { HUMAN, baseRaid, effect, human, loadRaid, roster, runTicks, withEffect, byId, noMove } from "./helpers";
import { DPS_HP, HEALER_HP, TANK_HP } from "./constants";

// --- set_hp ---

test("set_hp sets all alive players HP to the given amount", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ type: "set_hp", t: 0, name: "Seismic Crush", amount: 1 }],
  });
  const world = runTicks(createWorld(raid), noMove, 2);
  for (const p of world.players) {
    expect(p.hp).toBe(1);
  }
});

test("set_hp clamps to maxHp", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ type: "set_hp", t: 0, name: "Seismic Crush", amount: 999999 }],
  });
  const world = runTicks(createWorld(raid), noMove, 2);
  expect(human(world).hp).toBe(DPS_HP);
});

test("set_hp with role filter only affects that role", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ type: "set_hp", t: 0, name: "Seismic Crush", amount: 1, role: "tank" }],
  });
  const world = runTicks(createWorld(raid), noMove, 2);
  expect(byId(world, "mt").hp).toBe(1);
  expect(byId(world, "ot").hp).toBe(1);
  expect(human(world).hp).toBe(DPS_HP); // dps untouched
  expect(byId(world, "h1").hp).toBe(HEALER_HP); // healer untouched
});

test("set_hp with players filter only affects listed ids", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [{ type: "set_hp", t: 0, name: "Seismic Crush", amount: 1, players: ["mt"] }],
  });
  const world = runTicks(createWorld(raid), noMove, 2);
  expect(byId(world, "mt").hp).toBe(1);
  expect(byId(world, "ot").hp).toBe(TANK_HP);
});

// --- Primordial Crust ---

test("primordialCrust converts a lethal hit to 1 HP and removes the debuff", () => {
  // Use raid events so player positions and world state are consistent.
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] } }),
    events: [
      { type: "apply_effect", t: 0, name: "Apply Crust", players: ["m1"],
        applyEffect: { name: "Primordial Crust", kind: "debuff", duration: 30,
          behavior: { kind: "primordialCrust", expiryDamage: 999999, expiryDamageType: "true" } } },
      { type: "set_hp", t: 0.5, name: "Seismic", amount: 1 },
      { t: 1, name: "Lethal Hit", telegraph: 0.1, damage: 999999, damageType: "physical" as const,
        shape: { kind: "circle" as const, center: [0, 0] as [number, number], radius: 5 } },
    ],
  });
  const after = runTicks(createWorld(raid), noMove, Math.ceil(2 * 60));
  expect(human(after).alive).toBe(true);
  expect(human(after).hp).toBe(1);
  expect(human(after).effects.some(e => e.behavior.kind === "primordialCrust")).toBe(false);
});

test("primordialCrust expiry burst kills uncleansed carrier", () => {
  const crustEffect = effect({
    id: "crust-1",
    name: "Primordial Crust",
    appliedAt: 0,
    duration: 1,
    behavior: { kind: "primordialCrust" as const, expiryDamage: 999999, expiryDamageType: "true" as const },
  });
  const world = withEffect(createWorld(loadRaid(baseRaid)), crustEffect);
  const after = runTicks(world, noMove, Math.ceil(2 * 60));
  expect(human(after).alive).toBe(false);
});

test("primordialCrust expiry does not fire before expiry tick", () => {
  const crustEffect = effect({
    id: "crust-1",
    name: "Primordial Crust",
    appliedAt: 0,
    duration: 10,
    behavior: { kind: "primordialCrust" as const, expiryDamage: 999999, expiryDamageType: "true" as const },
  });
  const world = withEffect(createWorld(loadRaid(baseRaid)), crustEffect);
  const after = runTicks(world, noMove, Math.ceil(5 * 60));
  expect(human(after).alive).toBe(true);
});

// --- Accretion ---

test("accretion is removed when healed to full HP", () => {
  const accretionEffect = effect({
    id: "accretion-1",
    name: "Accretion",
    appliedAt: 0,
    duration: 30,
    behavior: { kind: "accretion" as const, expiryDamage: 999999, expiryDamageType: "true" as const },
  });
  // The heal event fires at t=1, setting hp to maxHp. statusEffects should then drop accretion.
  const raid = loadRaid({
    ...baseRaid,
    events: [{ type: "heal", t: 1, name: "Earthen Favor" }],
  });
  const world = withEffect(createWorld(raid), accretionEffect);
  const after = runTicks(world, noMove, Math.ceil(2 * 60));
  expect(human(after).alive).toBe(true);
  expect(human(after).effects.some(e => e.behavior.kind === "accretion")).toBe(false);
});

test("accretion expiry burst kills uncleansed carrier", () => {
  // Player must be below full HP so the cleanse-on-full pass doesn't fire immediately.
  // In the G7 puzzle the player is at 1 HP from a prior set_hp; we replicate that here.
  const accretionEffect = effect({
    id: "accretion-1",
    name: "Accretion",
    appliedAt: 0,
    duration: 1,
    behavior: { kind: "accretion" as const, expiryDamage: 999999, expiryDamageType: "true" as const },
  });
  const worldBase = withEffect(createWorld(loadRaid(baseRaid)), accretionEffect);
  const world = {
    ...worldBase,
    players: worldBase.players.map(p => p.id === HUMAN ? { ...p, hp: 1 } : p),
  };
  const after = runTicks(world, noMove, Math.ceil(2 * 60));
  expect(human(after).alive).toBe(false);
});

test("accretion is not removed when hp is below max", () => {
  const accretionEffect = effect({
    id: "accretion-1",
    name: "Accretion",
    appliedAt: 0,
    duration: 10,
    behavior: { kind: "accretion" as const, expiryDamage: 999999, expiryDamageType: "true" as const },
  });
  // Player stays at less than full HP throughout — no heal, no removal.
  const world = {
    ...withEffect(createWorld(loadRaid(baseRaid)), accretionEffect),
    players: withEffect(createWorld(loadRaid(baseRaid)), accretionEffect).players.map(p =>
      p.id === HUMAN ? { ...p, hp: p.maxHp - 1 } : p
    ),
  };
  const after = runTicks(world, noMove, Math.ceil(5 * 60));
  expect(human(after).effects.some(e => e.behavior.kind === "accretion")).toBe(true);
});
