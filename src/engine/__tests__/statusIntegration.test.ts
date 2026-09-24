import { expect, test } from "bun:test";
import type { Intents, World } from "@model/types";
import { MOVE_SPEED } from "@shared/constants";
import { hasActiveStatus, remainingTime, requireStatus } from "@status";
import { tick } from "../sim";
import { createWorld } from "../world";
import { DPS_HP } from "./constants";
import { HUMAN, baseRaid, human, loadRaid, roster, runTicks } from "./helpers";
import type { Vec } from "./helpers";

const DT = 1 / 60;
const SPRINT = requireStatus("sprint");
const SPRINT_TICKS = Math.round(SPRINT.duration / DT);
const east = { [HUMAN]: { move: { x: 1, z: 0 } } };

function openRaid(events: unknown[] = [], spawns: Record<string, { spawn: Vec }> = {}) {
  return loadRaid({
    ...baseRaid,
    arena: { zones: [{ kind: "circle" as const, center: [0, 0] as Vec, radius: 200 }] },
    players: roster(spawns),
    events,
  });
}

function stepX(world: World, intents: Intents): { world: World; dx: number } {
  const before = human(world).pos.x;
  const next = tick(world, intents, DT);
  return { world: next, dx: human(next).pos.x - before };
}

test("Sprint is a status that speeds movement for exactly its catalog duration", () => {
  let world = createWorld(openRaid());
  let step = stepX(world, { [HUMAN]: { move: { x: 1, z: 0 }, sprint: true } });
  world = step.world;
  expect(step.dx).toBeCloseTo(MOVE_SPEED * 1.3 * DT);
  expect(remainingTime(human(world), "sprint", world.time)).toBeCloseTo(SPRINT.duration);
  for (let i = 1; i < SPRINT_TICKS - 1; i++) world = tick(world, east, DT);
  step = stepX(world, east);
  world = step.world;
  expect(step.dx).toBeCloseTo(MOVE_SPEED * 1.3 * DT);
  step = stepX(world, east);
  world = step.world;
  expect(step.dx).toBeCloseTo(MOVE_SPEED * DT);
  expect(human(world).effects.some(status => status.ref === "sprint")).toBe(false);
});

test("Sprint recast with cooldowns disabled refreshes the single instance", () => {
  let world = tick(createWorld(openRaid()), { [HUMAN]: { move: { x: 0, z: 0 }, toggleCooldowns: true, sprint: true } }, DT);
  world = runTicks(world, {}, 120);
  world = tick(world, { [HUMAN]: { move: { x: 0, z: 0 }, sprint: true } }, DT);
  const sprints = human(world).effects.filter(status => status.ref === "sprint");
  expect(sprints).toHaveLength(1);
  expect(sprints[0]!.appliedAt).toBe(world.time);
  expect(human(world).sprintCooldown).toBe(0);
});

test("Arm's Length blocks mechanic knockback without consuming a directional modifier", () => {
  const raid = openRaid([
    { type: "apply_effect", id: "wind", t: 0, name: "Wind", players: [HUMAN], applyEffect: { ref: "tailwind" } },
    { t: 0.2, name: "Push", telegraph: 0.1, damage: 0, damageType: "magical" as const,
      shape: { kind: "circle" as const, center: [0, 0] as Vec, radius: 20 }, knockback: { distance: 6 } },
  ], { [HUMAN]: { spawn: [2, 0] } });
  let world = tick(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 }, antiKnockback: true } }, DT);
  world = runTicks(world, {}, 30);
  expect(human(world).pos.x).toBeCloseTo(2);
  expect(hasActiveStatus(human(world), "tailwind", world.time)).toBe(true);
  expect(hasActiveStatus(human(world), "arms_length", world.time)).toBe(true);
});

test("a failed motion check still launches a knockback-immune carrier", () => {
  const raid = openRaid([
    { type: "apply_effect", id: "bomb", t: 0, name: "Bomb", players: [HUMAN], applyEffect: { ref: "acceleration_bomb", duration: 0.5 } },
  ]);
  let world = tick(createWorld(raid), { [HUMAN]: { move: { x: 1, z: 0 }, antiKnockback: true } }, DT);
  world = runTicks(world, east, 35);
  expect(human(world).y).toBeGreaterThan(0);
  expect(human(world).effects.some(status => status.ref === "motion_check_landing" && status.name === "Acceleration Bomb")).toBe(true);
});

const chainEvent = {
  type: "chain" as const, t: 0.1, name: "Test Chain", pairs: [[HUMAN, "ot"]] as [string, string][],
  telegraph: 0.5, breakWindow: 5, breakDistance: 12, breakDamage: 40, damageType: "magical" as const,
  debuff: "first_in_line",
};

test("chains keep their registered debuff and never run its expiry when removed", () => {
  const raid = openRaid([chainEvent], { [HUMAN]: { spawn: [0, 0] }, ot: { spawn: [1, 0] } });
  let world = runTicks(createWorld(raid), {}, Math.ceil(0.7 * 60));
  const bond = human(world).effects.find(status => status.id.endsWith(`-${HUMAN}-eff`))!;
  expect(bond).toMatchObject({ ref: "first_in_line", name: "First in Line", icon: "first_in_line.png", duration: 5 });
  world = runTicks(world, {}, 6 * 60);
  expect(human(world).hp).toBe(DPS_HP - 40);
  expect(human(world).effects.some(status => status.ref === "first_in_line")).toBe(false);

  let broken = runTicks(createWorld(raid), {}, Math.ceil(0.7 * 60));
  broken = runTicks(broken, { [HUMAN]: { move: { x: -1, z: 0 } } }, 4 * 60);
  broken = runTicks(broken, {}, 3 * 60);
  expect(human(broken).hp).toBe(DPS_HP);
});

test("line links keep their registered hidden debuff and never run its expiry when removed", () => {
  const raid = openRaid([{
    type: "line_link", t: 0.1, name: "Statue", pos: [0, 20] as Vec, resolveAfter: 0.5,
    target: { playerIds: [HUMAN] }, hiddenDebuff: "first_in_line",
  }]);
  let world = runTicks(createWorld(raid), {}, 20);
  expect(human(world).effects.find(status => status.id.endsWith("-hidden"))).toMatchObject({
    ref: "first_in_line", icon: "first_in_line.png", visibility: "invisible",
  });
  world = runTicks(world, {}, 60);
  expect(human(world).hp).toBe(DPS_HP);
  expect(human(world).effects).toEqual([]);
});

test("status consumption leaves previous world snapshots untouched", () => {
  const raid = openRaid([
    { type: "apply_effect", id: "vuln", t: 0, name: "Vuln", players: [HUMAN], applyEffect: { ref: "spells_trouble" } },
  ]);
  const world = runTicks(createWorld(raid), {}, 2);
  const frozen = JSON.stringify(world.players);
  const next = tick(world, { [HUMAN]: { move: { x: 0, z: 0 }, sprint: true, antiKnockback: true } }, DT);
  expect(JSON.stringify(world.players)).toBe(frozen);
  expect(human(next).effects.map(status => status.ref)).toEqual(["spells_trouble", "sprint", "arms_length"]);
});
