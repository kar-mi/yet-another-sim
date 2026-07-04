import { expect, test } from "bun:test";
import { add, dot, length, normalize, scale } from "@shared/math";
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

test("Look Upon Me beams from bigkefka toward arena centre, and the party dodges both it and Damning Edict 2 for any teleport/bait outcome", async () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
    const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
    const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
    const world = runTicksWithComputedBotIntents(createWorld(raid, seed), Math.ceil(87 * 60));

    // Look Upon Me's telegraphed direction should point from bigkefka's (teleported) position
    // toward arena centre, not the old hardcoded south vector.
    const kefka = world.bosses.find(b => b.id === "bigkefka")!;
    const lookUponMe = world.active.find(m => m.id === "look-upon-me-1")!;
    const shape = lookUponMe.shape;
    if (shape.kind !== "rect") throw new Error("expected look-upon-me-1 to be a rect shape");
    const expectedDirection = normalize(scale(kefka.pos, -1));
    expect(shape.direction.x).toBeCloseTo(expectedDirection.x, 6);
    expect(shape.direction.z).toBeCloseTo(expectedDirection.z, 6);

    // Every dodge spot is purely lateral to Kefka's beam (zero component along his facing) at
    // exactly dist 7 (party) or 10 (ot) from arena centre - clear of the beam's 6.67 half-width
    // regardless of bearing, and (since chaos sits at arena centre) mirrorLateral guarantees it's
    // also on the side away from Damning Edict 2's cone for whichever random target got baited.
    const chaos = world.bosses.find(b => b.id === "chaos")!;
    const kefkaFacing = { x: sin(kefka.facing), z: cos(kefka.facing) };
    const chaosFacing = { x: sin(chaos.facing), z: cos(chaos.facing) };
    for (const [id, dist] of [["mt", 7], ["h1", 7], ["r2", 7], ["ot", 10]] as const) {
      const target = genericSolverWaypoint(byId(world, id), world)!;
      expect(target).toBeDefined();
      expect(length(target)).toBeCloseTo(dist, 6);
      expect(dot(target, kefkaFacing)).toBeCloseTo(0, 6); // purely lateral to the beam
      expect(dot(target, chaosFacing)).toBeLessThan(0); // safe half of the Edict's cone
    }
  }
});

// Tether assignments are driven by First/Second/Third in Line + role, never a hardcoded player id.
// first_in_line has two dps (r1, m1); which one carries Accretion (and so solos the 3rd tether
// instead of doing the 1st tether's hand-off) is picked by a seeded RNG eventSet
// (accretion-duty-first-in-line in black-hole.yaml), so this must hold for either outcome.
test("Black Hole tether assignments resolve correctly from debuffs regardless of which dps gets Accretion Duty", async () => {
  for (const seed of [1, 5]) {
    const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
    const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
    const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
    let world = runTicksWithComputedBotIntents(createWorld(raid, seed), Math.ceil(18 * 60));

    const hasDebuff = (id: string, name: string) => byId(world, id).effects.some(e => e.name === name);
    const accretionCarrier = hasDebuff("m1", "Accretion Duty") ? "m1" : "r1";
    const dpsHandoff = accretionCarrier === "m1" ? "r1" : "m1";
    expect(hasDebuff(accretionCarrier, "Accretion Duty")).toBe(true);
    expect(hasDebuff(dpsHandoff, "Accretion Duty")).toBe(false);

    const notCenter = (id: string) => expect(genericSolverWaypoint(byId(world, id), world)).not.toEqual({ x: 0, z: 0 });
    const atCenter = (id: string) => expect(genericSolverWaypoint(byId(world, id), world)).toEqual({ x: 0, z: 0 });

    // wave 1 (t=40): real Accretion (applied at t=17, 11s duration) has already expired, so the
    // Accretion-tagged dps has nothing to do in Black Hole 1 - only the untagged dps (laser-1) is
    // active; the tank's laser-2 window hasn't opened yet either.
    world = runTicksWithComputedBotIntents(world, Math.ceil((40 - 18) * 60));
    notCenter(dpsHandoff);
    atCenter(accretionCarrier);

    // wave 2 (t=47): the same untagged dps has moved on to laser-3 (free again since laser-1 only
    // fired once) - the Accretion-tagged dps is still uninvolved.
    world = runTicksWithComputedBotIntents(world, Math.ceil((47 - 40) * 60));
    notCenter(dpsHandoff);
    atCenter(accretionCarrier);

    // wave 6 (t=105): DPS/Support hand-off has moved on to second_in_line, and Accretion has
    // switched carriers to h2 (second_in_line's healer) - r1/m1 are done for the fight.
    world = runTicksWithComputedBotIntents(world, Math.ceil((105 - 47) * 60));
    atCenter(dpsHandoff);
    atCenter(accretionCarrier);
    expect(hasDebuff("h2", "Accretion Duty")).toBe(true);
    notCenter("r2"); // second_in_line's dps, doing the wave-6 hand-off
    notCenter("h2"); // second_in_line's healer, soloing Accretion's tether

    // wave 9 (t=138): DPS/Support chains have both reached third_in_line; m2 (dps) and h1 (healer,
    // its only non-dps member) are the ones active - no Accretion carrier this late.
    world = runTicksWithComputedBotIntents(world, Math.ceil((138 - 105) * 60));
    notCenter("m2");
    notCenter("h1");
  }
});
