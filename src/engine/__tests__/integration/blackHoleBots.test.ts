import { expect, test } from "bun:test";
import { genericSolverWaypoint } from "../../genericSolver";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../../raidLoader";
import { createWorld } from "../../world";
import { byId, runTicksWithComputedBotIntents } from "../helpers";

test("black-hole raid and bot companion load with resolved tether frame positions", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
  const world = createWorld(raid, 1);

  expect(raid.botPatterns).toBe("black-hole-bots");
  expect(world.botSolvers?.generic?.length).toBeGreaterThan(0);
  expect(world.eventPositions["black-hole-1-laser-1"]).toBeDefined();
  expect(world.eventPositions["black-hole-2-laser-1"]).toBeDefined();
  expect(world.pendingTethers.filter(tether => tether.id.startsWith("black-hole-2-laser"))).toHaveLength(3);
});

test("black-hole bots survive the first Slap Happy side cleave", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
  const world = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(31.1 * 60));

  expect(world.status).toBe("running");
  expect(world.players.every(player => player.alive)).toBe(true);
});

test("a tank mid laser-soak keeps soaking through tb-4 instead of baiting the tank buster", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
  const world = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(49.1 * 60));

  // At t=49.1, mt is mid black-hole-1-laser-2 soak and tb-4 (thunder-iii-tb-4) is also live: mt
  // must stay on its laser-soak spot, not the shared tb bait spot at {7,0}.
  const mtTarget = genericSolverWaypoint(byId(world, "mt"), world);
  expect(mtTarget).toBeDefined();
  expect(mtTarget).not.toEqual({ x: 7, z: 0 });

  // ot isn't soaking a laser at t=49.1, so it falls through to solo-bait tb-4 at the shared spot.
  const otTarget = genericSolverWaypoint(byId(world, "ot"), world);
  expect(otTarget).toEqual({ x: 7, z: 0 });
});
