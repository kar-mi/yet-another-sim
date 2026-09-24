import { expect, test } from "bun:test";
import { tick } from "../sim";
import { PROVOKE_COOLDOWN } from "@shared/constants";
import { createWorld } from "../world";
import { HUMAN, baseRaid, byId, human, loadRaid } from "./helpers";
import type { Vec } from "./helpers";

const twoBossRaid = {
  ...baseRaid,
  bosses: [
    { id: "chaos", pos: [-10, 0] as Vec, aggro: "mt" },
    { id: "exdeath", pos: [10, 0] as Vec, aggro: "ot" },
  ],
};

test("a tank provoke flips the boss's current target to that tank", () => {
  const raid = loadRaid(baseRaid);
  const world = createWorld(raid);
  expect(world.boss.currentTarget).toBe("mt");

  const w = tick(world, { ot: { move: { x: 0, z: 0 }, provoke: true } }, 1 / 60);
  expect(w.boss.currentTarget).toBe("ot");
  expect(byId(w, "ot").provokeCooldown).toBeGreaterThan(0);
});

test("provoke is tank-only: a dps press does nothing", () => {
  const raid = loadRaid(baseRaid);
  const world = createWorld(raid);
  const w = tick(world, { [HUMAN]: { move: { x: 0, z: 0 }, provoke: true } }, 1 / 60);
  expect(w.boss.currentTarget).toBe("mt");
  expect(human(w).provokeCooldown).toBe(0);
});

test("provoke respects its cooldown", () => {
  const raid = loadRaid(baseRaid);
  let w = tick(createWorld(raid), { ot: { move: { x: 0, z: 0 }, provoke: true } }, 1 / 60);
  expect(byId(w, "ot").provokeCooldown).toBeGreaterThan(PROVOKE_COOLDOWN - 1);

  w = tick(w, { mt: { move: { x: 0, z: 0 }, provoke: true } }, 1 / 60);
  expect(w.boss.currentTarget).toBe("mt");
  const otCdBefore = byId(w, "ot").provokeCooldown;
  w = tick(w, { ot: { move: { x: 0, z: 0 }, provoke: true } }, 1 / 60);
  expect(w.boss.currentTarget).toBe("mt");
  expect(byId(w, "ot").provokeCooldown).toBeLessThan(otCdBefore);
});

test("all players start targeting bosses[0]", () => {
  const raid = loadRaid(twoBossRaid);
  const w = createWorld(raid);
  for (const p of w.players) {
    expect(p.targetBossId).toBe("chaos");
  }
});

test("cycleTarget advances targetBossId to the next boss and wraps", () => {
  const raid = loadRaid(twoBossRaid);
  let w = createWorld(raid);
  expect(byId(w, "mt").targetBossId).toBe("chaos");

  w = tick(w, { mt: { move: { x: 0, z: 0 }, cycleTarget: true } }, 1 / 60);
  expect(byId(w, "mt").targetBossId).toBe("exdeath");

  w = tick(w, { mt: { move: { x: 0, z: 0 }, cycleTarget: true } }, 1 / 60);
  expect(byId(w, "mt").targetBossId).toBe("chaos");
});

test("cycleTarget is available to all roles (dps can cycle)", () => {
  const raid = loadRaid(twoBossRaid);
  let w = createWorld(raid);
  expect(byId(w, HUMAN).targetBossId).toBe("chaos");

  w = tick(w, { [HUMAN]: { move: { x: 0, z: 0 }, cycleTarget: true } }, 1 / 60);
  expect(byId(w, HUMAN).targetBossId).toBe("exdeath");
});

test("two-boss provoke flips only the targeted boss, not the other", () => {
  const raid = loadRaid(twoBossRaid);
  let w = createWorld(raid);
  expect(w.bosses.find(b => b.id === "chaos")!.currentTarget).toBe("mt");
  expect(w.bosses.find(b => b.id === "exdeath")!.currentTarget).toBe("ot");

  w = tick(w, { ot: { move: { x: 0, z: 0 }, cycleTarget: true } }, 1 / 60);
  expect(byId(w, "ot").targetBossId).toBe("exdeath");

  w = tick(w, { ot: { move: { x: 0, z: 0 }, provoke: true } }, 1 / 60);
  expect(w.bosses.find(b => b.id === "chaos")!.currentTarget).toBe("mt");
  expect(w.bosses.find(b => b.id === "exdeath")!.currentTarget).toBe("ot");
});

test("dps cycleTarget works but dps provoke is a no-op", () => {
  const raid = loadRaid(twoBossRaid);
  let w = createWorld(raid);
  const chaosTargetBefore = w.bosses.find(b => b.id === "chaos")!.currentTarget;

  w = tick(w, { [HUMAN]: { move: { x: 0, z: 0 }, cycleTarget: true } }, 1 / 60);
  expect(byId(w, HUMAN).targetBossId).toBe("exdeath");

  w = tick(w, { [HUMAN]: { move: { x: 0, z: 0 }, provoke: true } }, 1 / 60);
  expect(w.bosses.find(b => b.id === "chaos")!.currentTarget).toBe(chaosTargetBefore);
  expect(w.bosses.find(b => b.id === "exdeath")!.currentTarget).toBe("ot");
  expect(byId(w, HUMAN).provokeCooldown).toBe(0);
});

