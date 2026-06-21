import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { DPS_HP } from "./constants";
import { baseRaid, byId, effect, loadRaid, roster, runTicks, withPlayerEffect } from "./helpers";

type Destination =
  | { to: [number, number] }
  | { debuff: string }
  | { bait: "closest" | "furthest" | "random" | "aggro"; role?: "tank" | "healer" | "dps" };

function dashRaid(destination: Destination) {
  return loadRaid({
    ...baseRaid,
    duration: 5,
    players: roster({ r1: { spawn: [12, 0] }, r2: { spawn: [13, 0] }, m1: { spawn: [10, 0] }, m2: { spawn: [15, 0] } }),
    events: [
      {
        type: "aoe", id: "landing-aoe", t: 0.1, name: "Landing AOE", deferred: true,
        anchor: "boss", telegraph: 0.5, damage: 40, damageType: "physical",
        shape: { kind: "circle", center: [0, 0], radius: 3 },
      },
      {
        type: "dash", id: "dash", t: 0.5, name: "Boss Dash", telegraph: 0.5,
        destination, link: "landing-aoe", showCastBar: true,
      },
    ],
  });
}

test("dash blinks at cast end, then gives the linked AOE a fresh telegraph", () => {
  let world = runTicks(createWorld(dashRaid({ to: [10, 0] })), {}, 48); // t=0.8
  const castPosition = { ...world.boss.pos };
  expect(world.active.find(mechanic => mechanic.id === "dash-landing")?.shape).toEqual({
    kind: "circle", center: { x: 10, z: 0 }, radius: world.boss.radius,
  });

  world = runTicks(world, {}, 11); // still before t=1
  expect(world.boss.pos).toEqual(castPosition);
  expect(byId(world, "m1").hp).toBe(DPS_HP);

  world = runTicks(world, {}, 2); // dash has resolved, landing AOE is now casting
  expect(world.boss.pos).toEqual({ x: 10, z: 0 });
  expect(world.active.find(mechanic => mechanic.id === "landing-aoe")?.resolved).toBe(false);
  expect(byId(world, "m1").hp).toBe(DPS_HP);

  world = runTicks(world, {}, 31); // past t=1.5
  expect(byId(world, "m1").hp).toBeLessThan(DPS_HP);
  expect(byId(world, "m2").hp).toBe(DPS_HP);
});

test("dash lands on the closest active debuff carrier", () => {
  let world = createWorld(dashRaid({ debuff: "Marked" }));
  world = withPlayerEffect(world, "m2", effect({ name: "Marked" }));
  world = runTicks(world, {}, 61);
  expect(world.boss.pos).toEqual(byId(world, "m2").pos);
});

test("closest and furthest dash destinations resolve at cast end", () => {
  const closest = runTicks(createWorld(dashRaid({ bait: "closest", role: "dps" })), {}, 61);
  expect(closest.boss.pos).toEqual(byId(closest, "m1").pos);

  const furthest = runTicks(createWorld(dashRaid({ bait: "furthest", role: "dps" })), {}, 61);
  expect(furthest.boss.pos).toEqual(byId(furthest, "m2").pos);
});

test("dash and its linked AOE fully clear from resolution state", () => {
  const world = runTicks(createWorld(dashRaid({ to: [10, 0] })), {}, 150);
  expect(world.pendingDashes).toHaveLength(0);
  expect(world.active.some(mechanic => !mechanic.resolved)).toBe(false);
});
