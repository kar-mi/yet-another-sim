import { expect, test } from "bun:test";
import { tick, PROVOKE_COOLDOWN } from "../sim";
import { createWorld } from "../world";
import { HUMAN, baseRaid, byId, human, loadRaid } from "./helpers";

test("a tank provoke flips the boss's current target to that tank", () => {
  const raid = loadRaid(baseRaid);
  const world = createWorld(raid);
  expect(world.boss.currentTarget).toBe("mt"); // mt seeded as initial target

  // ot (the other tank) provokes -> becomes the top-threat target.
  const w = tick(world, { ot: { move: { x: 0, z: 0 }, provoke: true } }, 1 / 60);
  expect(w.boss.currentTarget).toBe("ot");
  expect(byId(w, "ot").provokeCooldown).toBeGreaterThan(0);
});

test("provoke is tank-only: a dps press does nothing", () => {
  const raid = loadRaid(baseRaid);
  const world = createWorld(raid);
  // m1 is a dps; pressing provoke must not grab threat or start a cooldown.
  const w = tick(world, { [HUMAN]: { move: { x: 0, z: 0 }, provoke: true } }, 1 / 60);
  expect(w.boss.currentTarget).toBe("mt");
  expect(human(w).provokeCooldown).toBe(0);
});

test("provoke respects its cooldown", () => {
  const raid = loadRaid(baseRaid);
  let w = tick(createWorld(raid), { ot: { move: { x: 0, z: 0 }, provoke: true } }, 1 / 60);
  expect(byId(w, "ot").provokeCooldown).toBeGreaterThan(PROVOKE_COOLDOWN - 1);

  // mt provokes back while ot is still on cooldown; pressing again on ot is a no-op.
  w = tick(w, { mt: { move: { x: 0, z: 0 }, provoke: true } }, 1 / 60);
  expect(w.boss.currentTarget).toBe("mt");
  const otCdBefore = byId(w, "ot").provokeCooldown;
  w = tick(w, { ot: { move: { x: 0, z: 0 }, provoke: true } }, 1 / 60);
  expect(w.boss.currentTarget).toBe("mt"); // ot still on cooldown, no re-grab
  expect(byId(w, "ot").provokeCooldown).toBeLessThan(otCdBefore); // only counting down
});

