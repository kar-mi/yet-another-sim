import { expect, test } from "bun:test";
import { tick, DEATH_FLOOR_Y } from "../sim";
import { createWorld } from "../world";
import { HUMAN, baseRaid, human, loadRaid, roster, runTicks } from "./helpers";

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

test("intent.facing overrides movement-derived facing (e.g. legacy strafe)", () => {
  const raid = loadRaid(baseRaid);
  const world = createWorld(raid);

  // Moving +x but facing forced forward (+z) — like strafing while facing the camera.
  const strafed = tick(world, { [HUMAN]: { move: { x: 1, z: 0 }, facing: 0 } }, 1 / 60);
  expect(human(strafed).pos.x).toBeGreaterThan(human(world).pos.x);
  expect(human(strafed).facing).toBeCloseTo(0);

  // Facing-only update with no movement (turning in place).
  const turned = tick(strafed, { [HUMAN]: { move: { x: 0, z: 0 }, facing: Math.PI / 2 } }, 1 / 60);
  expect(human(turned).pos.x).toBeCloseTo(human(strafed).pos.x);
  expect(human(turned).facing).toBeCloseTo(Math.PI / 2);
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

