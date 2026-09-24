import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { HUMAN, baseRaid, effect, human, loadRaid, roster, runTicks, withEffect, byId, noMove } from "./helpers";
import { DPS_HP, HEALER_HP, TANK_HP } from "./constants";

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
  expect(human(world).hp).toBe(DPS_HP);
  expect(byId(world, "h1").hp).toBe(HEALER_HP);
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

test("primordialCrust converts a lethal hit to 1 HP and removes the debuff", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] } }),
    events: [
      { type: "apply_effect", t: 0, name: "Apply Crust", players: ["m1"],
        applyEffect: { ref: "primordial_crust", duration: 30 } },
      { type: "set_hp", t: 0.5, name: "Seismic", amount: 1 },
      { t: 1, name: "Lethal Hit", telegraph: 0.1, damage: 999999, damageType: "physical" as const,
        shape: { kind: "circle" as const, center: [0, 0] as [number, number], radius: 5 } },
    ],
  });
  const after = runTicks(createWorld(raid), noMove, Math.ceil(2 * 60));
  expect(human(after).alive).toBe(true);
  expect(human(after).hp).toBe(1);
  expect(human(after).effects.some(e => e.name === "Primordial Crust")).toBe(false);
});

test("primordialCrust expiry burst kills uncleansed carrier", () => {
  const crustEffect = effect({
    id: "crust-1",
    name: "Primordial Crust",
    appliedAt: 0,
    duration: 1,
    behavior: { kind: "expiryDamage" as const, expiryDamage: 999999, expiryDamageType: "true" as const, surviveLethal: true },
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
    behavior: { kind: "expiryDamage" as const, expiryDamage: 999999, expiryDamageType: "true" as const, surviveLethal: true },
  });
  const world = withEffect(createWorld(loadRaid(baseRaid)), crustEffect);
  const after = runTicks(world, noMove, Math.ceil(5 * 60));
  expect(human(after).alive).toBe(true);
});

test("accretion is removed when healed to full HP", () => {
  const accretionEffect = effect({
    id: "accretion-1",
    name: "Accretion",
    appliedAt: 0,
    duration: 30,
    behavior: { kind: "expiryDamage" as const, expiryDamage: 999999, expiryDamageType: "true" as const, cleanseAtFullHp: true },
  });
  const raid = loadRaid({
    ...baseRaid,
    events: [{ type: "heal", t: 1, name: "Earthen Favor" }],
  });
  const worldBase = withEffect(createWorld(raid), accretionEffect);
  const world = {
    ...worldBase,
    players: worldBase.players.map(p => p.id === HUMAN ? { ...p, hp: 1 } : p),
  };
  const before = runTicks(world, noMove, Math.ceil(0.9 * 60));
  expect(human(before).effects.some(e => e.name === "Accretion")).toBe(true);
  const after = runTicks(world, noMove, Math.ceil(1.1 * 60));
  expect(human(after).alive).toBe(true);
  expect(human(after).effects.some(e => e.name === "Accretion")).toBe(false);
});

test("accretion expiry burst kills uncleansed carrier", () => {
  const accretionEffect = effect({
    id: "accretion-1",
    name: "Accretion",
    appliedAt: 0,
    duration: 1,
    behavior: { kind: "expiryDamage" as const, expiryDamage: 999999, expiryDamageType: "true" as const, cleanseAtFullHp: true },
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
    behavior: { kind: "expiryDamage" as const, expiryDamage: 999999, expiryDamageType: "true" as const, cleanseAtFullHp: true },
  });
  const world = {
    ...withEffect(createWorld(loadRaid(baseRaid)), accretionEffect),
    players: withEffect(createWorld(loadRaid(baseRaid)), accretionEffect).players.map(p =>
      p.id === HUMAN ? { ...p, hp: p.maxHp - 1 } : p
    ),
  };
  const after = runTicks(world, noMove, Math.ceil(5 * 60));
  expect(human(after).effects.some(e => e.name === "Accretion")).toBe(true);
});
