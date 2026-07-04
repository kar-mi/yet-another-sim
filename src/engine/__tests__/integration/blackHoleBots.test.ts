import { expect, test } from "bun:test";
import { add, scale } from "@shared/math";
import { cos, sin } from "@shared/dmath";
import { genericFrameNorth, genericSolverWaypoint } from "../../genericSolver";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../../raidLoader";
import { createWorld } from "../../world";
import { byId, runTicksWithComputedBotIntents } from "../helpers";

// Mirrors the engine's polar-spot -> world conversion (src/engine/world.ts toSpot) for a given
// frame north/right and origin, so tests can independently pin the exact expected position.
function polarWorld(origin: { x: number; z: number }, north: { x: number; z: number }, dist: number, angleDeg: number) {
  const right = { x: north.z, z: -north.x };
  const angle = (angleDeg * Math.PI) / 180;
  return add(origin, add(scale(right, dist * sin(angle)), scale(north, dist * cos(angle))));
}

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
  // must stay on its laser-soak spot, not the tb-4 tank formation.
  const mtTarget = genericSolverWaypoint(byId(world, "mt"), world);
  expect(mtTarget).toBeDefined();

  // ot isn't soaking a laser at t=49.1 and tb-4's formation puts both tanks exactly on exdeath's
  // current position (dist:0 in *thunderRelativeBait*), so ot should be standing on the boss.
  const exdeath = world.bosses.find(b => b.id === "exdeath")!;
  const otTarget = genericSolverWaypoint(byId(world, "ot"), world);
  expect(otTarget).toEqual(exdeath.pos);
  expect(otTarget).not.toEqual({ x: 7, z: 0 });
});

test("ot drags exdeath out toward Black Hole 1's 2nd tether ahead of tb-4", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
  const world = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(42 * 60));

  // Mid the ot drag-out window (40-45): ot should be walking toward the approach spot (12 out,
  // 240deg cw of the 2nd tether's bearing), not the stack-middle fallback or the old {7,0} bait.
  const north = genericFrameNorth(["black-hole-1-laser-2"], world)!;
  const otTarget = genericSolverWaypoint(byId(world, "ot"), world)!;
  expect(otTarget).toEqual(polarWorld({ x: 0, z: 0 }, north, 12, 240));
  expect(otTarget).not.toEqual({ x: 0, z: 0 });
  expect(otTarget).not.toEqual({ x: 7, z: 0 });

  // h1 is untouched by this change: it still resolves to the plain stack-middle spot.
  const h1Target = genericSolverWaypoint(byId(world, "h1"), world);
  expect(h1Target).toEqual({ x: 0, z: 0 });
});

test("tb-5's tank formation stands both tanks on exdeath's dragged position", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
  const world = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(91 * 60));

  // tb-5's formation is framed on black-hole-2-laser-3 (not laser-2) with *thunderRelativeBait*
  // (dist:0 for both tanks), so both mt and ot should resolve to exdeath's exact current position
  // regardless of the frame's north direction.
  const exdeath = world.bosses.find(b => b.id === "exdeath")!;
  const mtTarget = genericSolverWaypoint(byId(world, "mt"), world);
  const otTarget = genericSolverWaypoint(byId(world, "ot"), world);
  expect(mtTarget).toEqual(exdeath.pos);
  expect(otTarget).toEqual(exdeath.pos);
});

test("everyone regroups at arena centre for ~2s right after each Black Hole spawns, even soakers", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

  // Mid the Black Hole 2 override window (68.1-70): mt/r1/m1 would otherwise be at their orbs.
  const duringWorld = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(68.5 * 60));
  for (const id of ["mt", "r1", "m1", "h1"]) {
    expect(genericSolverWaypoint(byId(duringWorld, id), duringWorld)).toEqual({ x: 0, z: 0 });
  }

  // Right after the override window ends, mt resumes its Black Hole 2 laser-2 orb soak.
  const afterWorld = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(70.5 * 60));
  const mtTarget = genericSolverWaypoint(byId(afterWorld, "mt"), afterWorld);
  expect(mtTarget).not.toEqual({ x: 0, z: 0 });
});
