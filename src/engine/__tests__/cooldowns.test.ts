import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { createEmptyRaid } from "../../server/sessionRaid";
import { byId, effect, withPlayerEffect } from "./helpers";
import { ANTI_KB_DURATION, SPRINT_DURATION } from "@shared/constants";

const idle = { move: { x: 0, z: 0 } };
const cast = { ...idle, sprint: true, antiKnockback: true, provoke: true };
const dt = 1 / 60;

test("no cooldowns clears timers, allows recasts, and restores normal cooldowns when disabled", () => {
  let world = createWorld(createEmptyRaid());
  expect(byId(world, "mt").cooldownsDisabled).toBe(false);
  world = tick(world, { mt: cast, ot: cast }, dt);
  expect(byId(world, "mt").sprintCooldown).toBeGreaterThan(0);
  world = tick(world, { mt: { ...cast, toggleCooldowns: true } }, dt);
  for (let i = 0; i < 3; i++) {
    world = tick(world, { mt: cast }, dt);
    expect(byId(world, "mt")).toMatchObject({
      cooldownsDisabled: true, sprintCooldown: 0, antiKbCooldown: 0, provokeCooldown: 0,
      sprintActive: SPRINT_DURATION - dt, antiKbActive: ANTI_KB_DURATION - dt,
    });
    expect(world.boss.threat.mt).toBeGreaterThan(world.boss.threat.ot!);
  }
  expect(byId(world, "ot").cooldownsDisabled).toBe(false);
  expect(byId(world, "ot").sprintCooldown).toBeGreaterThan(0);
  expect(byId(world, "ot").antiKbCooldown).toBeGreaterThan(0);
  expect(byId(world, "ot").provokeCooldown).toBeGreaterThan(0);
  world = tick(world, { mt: { ...idle, toggleCooldowns: true } }, dt);
  expect(byId(world, "mt")).toMatchObject({ cooldownsDisabled: false, sprintCooldown: 0, antiKbCooldown: 0, provokeCooldown: 0 });
  world = tick(world, { mt: cast }, dt);
  expect(byId(world, "mt").sprintCooldown).toBeGreaterThan(0);
  expect(byId(world, "mt").antiKbCooldown).toBeGreaterThan(0);
  expect(byId(world, "mt").provokeCooldown).toBeGreaterThan(0);
});

test("no cooldowns preserves role restrictions and buff expiration", () => {
  let world = createWorld(createEmptyRaid());
  const threat = world.boss.threat.m1;
  world = tick(world, { m1: { ...cast, toggleCooldowns: true } }, dt);
  expect(world.boss.threat.m1).toBe(threat);
  for (let i = 0; i < (SPRINT_DURATION + ANTI_KB_DURATION + 1) * 60; i++) world = tick(world, {}, dt);
  expect(byId(world, "m1")).toMatchObject({ sprintActive: 0, antiKbActive: 0, cooldownsDisabled: true });
});

test("sleep and death block the personal cooldown toggle", () => {
  let world = withPlayerEffect(createWorld(createEmptyRaid()), "mt", effect({ behavior: { kind: "sleep" } }));
  byId(world, "ot").alive = false;
  world = tick(world, { mt: { ...idle, toggleCooldowns: true }, ot: { ...idle, toggleCooldowns: true } }, dt);
  expect(byId(world, "mt").cooldownsDisabled).toBe(false);
  expect(byId(world, "ot").cooldownsDisabled).toBe(false);
});
