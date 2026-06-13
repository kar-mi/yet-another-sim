import { expect, test } from "bun:test";
import { computeBotIntents } from "../botIntent";
import { tick } from "../sim";
import { createWorld } from "../world";
import { HUMAN, baseRaid, human, loadRaid, roster, runTicks, runTicksWithBotIntents } from "./helpers";
import type { Vec } from "./helpers";

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

test("knockback suppresses stale bot waypoints until the next authored waypoint", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({
      mt: {
        spawn: [2, 0],
        pattern: [{ t: 0, pos: [2, 0] }, { t: 2, pos: [2, 8] }],
      },
    }),
    events: [kbEvent({ distance: 6 })],
  });

  let world = runTicksWithBotIntents(createWorld(raid), Math.ceil(1 * 60));
  expect(world.players.find(p => p.id === "mt")!.pos.x).toBeGreaterThan(6);
  expect(computeBotIntents(world, 1 / 60).mt).toBeUndefined();

  world = runTicksWithBotIntents(world, Math.ceil(1.2 * 60));
  expect(computeBotIntents(world, 1 / 60).mt?.move?.z).toBeGreaterThan(0);
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
  let w1 = createWorld(raid, 1);
  let w2 = createWorld(raid, 1);
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

