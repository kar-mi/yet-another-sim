import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import { HEALER_HP } from "./constants";
import { baseRaid, byId, effect, human, loadRaid as loadTestRaid, noMove, roster, runTicksWithComputedBotIntents, withEffect } from "./helpers";

test("twister snapshots its expiry position and resolves after its delay", () => {
  const raid = loadTestRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] }, h1: { spawn: [1, 0] } }),
  });
  let world = withEffect(createWorld(raid), effect({
    name: "Twister",
    duration: 0.1,
    behavior: {
      kind: "twister",
      delay: 0.2,
      shownShape: "circle",
      hiddenShape: "donut",
      radius: 2,
      innerRadius: 0.5,
      damage: 20,
      damageType: "magical",
    },
  }));

  world = tick(world, noMove, 0.1);
  expect(human(world).hp).toBe(100);
  expect(byId(world, "h1").hp).toBe(HEALER_HP);
  expect(world.pendingTwisters).toHaveLength(1);
  expect(world.active).toHaveLength(0);

  world = {
    ...world,
    players: world.players.map(player => player.id === "m1"
      ? { ...player, pos: { x: 10, z: 0 } }
      : player),
  };
  world = tick(world, noMove, 0.19);
  expect(byId(world, "h1").hp).toBe(HEALER_HP);

  world = tick(world, noMove, 0.01);
  expect(human(world).hp).toBe(100);
  expect(byId(world, "h1").hp).toBe(HEALER_HP - 20);
  expect(world.pendingTwisters).toHaveLength(0);
  expect(world.active).toHaveLength(1);
  expect(world.active[0]!.shape).toEqual({ kind: "circle", center: { x: 0, z: 0 }, radius: 2 });
});

test("twister prevents a raid from clearing until the delayed burst resolves", () => {
  const world0 = withEffect({
    ...createWorld(loadTestRaid({ ...baseRaid, duration: 0.1 })),
    hasMechanics: true,
  }, effect({
    duration: 0.1,
    behavior: {
      kind: "twister",
      delay: 0.2,
      shownShape: "circle",
      hiddenShape: "circle",
      radius: 0.1,
      damage: 0,
      damageType: "true",
    },
  }));

  const world1 = tick(world0, noMove, 0.1);
  expect(world1.status).toBe("running");
  const world2 = tick(world1, noMove, 0.2);
  expect(world2.status).toBe("cleared");
});

test("twister validates delay and donut dimensions", () => {
  const twister = {
    name: "Twister",
    kind: "debuff",
    duration: 1,
    behavior: {
      kind: "twister",
      delay: -1,
      shownShape: "donut",
      hiddenShape: "circle",
      radius: 2,
      damage: 10,
      damageType: "magical",
    },
  };
  expect(() => loadTestRaid({
    ...baseRaid,
    events: [{
      t: 0.1,
      name: "Apply Twister",
      telegraph: 0.1,
      damage: 0,
      damageType: "magical",
      shape: { kind: "circle", center: [0, 0], radius: 1 },
      applyEffect: twister,
    }],
  })).toThrow();
});

test("Twister sample raid bots leave each snapped burst behind", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/debug/twister-test.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/debug/twister-test-bots.yaml").text());
  const world = runTicksWithComputedBotIntents(
    createWorld(applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData)), 1),
    9 * 60,
  );

  expect(world.players.every(player => player.alive)).toBe(true);
  expect(world.status).toBe("cleared");
});
