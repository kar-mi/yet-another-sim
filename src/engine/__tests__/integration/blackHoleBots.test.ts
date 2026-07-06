import { expect, test } from "bun:test";
import { add, dot, length, normalize, scale } from "@shared/math";
import { cos, sin } from "@shared/dmath";
import { genericFrameNorth, genericSolverWaypoint } from "../../genericSolver";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../../raidLoader";
import { pointInShape } from "../../shapes";
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

// The partySafeEast / roleSafeWest dodge spots are framed on Kefka's position but anchored on Chaos
// (origin: { boss: chaos }). Chaos chases mt (aggro: mt) and drifts a couple yalms off centre by the
// later Slap Happy waves, so the whole party formation shifts with it. This guards that the shift
// never carries anyone into one of Kefka's radius-8 cleave circles, for either rolled cleave side,
// across all three Slap Happy waves (t~=29, 60, 132). Asserted via the damage log rather than mere
// survival, since recovery heals between mechanics would otherwise mask a caught hit.
test("origin:chaos safe-spots keep the party clear of every Slap Happy cleave, all seeds", async () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
    const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
    const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
    const world = runTicksWithComputedBotIntents(createWorld(raid, seed), Math.ceil(136 * 60));

    const slapHits = world.log.filter(e => e.mechanic === "Slap Happy" && e.event === "hit");
    expect(slapHits).toHaveLength(0);
    expect(world.players.every(player => player.alive)).toBe(true);
  }
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

test("the party (tanks included) stays frozen on the LUM1 dodge spot through t=90.1, then tb-5's tank formation stands both tanks on exdeath's dragged position", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

  // At t=90, the freeze rule (static, 89-90.1) still wins over tb-5's formation for every bot,
  // including the tanks: they hold their LUM1 dodge spot instead of resolving onto exdeath yet.
  let world = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(90 * 60));
  expect(genericSolverWaypoint(byId(world, "mt"), world)).toEqual(byId(world, "mt").pos);
  expect(genericSolverWaypoint(byId(world, "ot"), world)).toEqual(byId(world, "ot").pos);

  // Once the freeze rule's endAt (90.1) passes, tb-5's formation (framed on black-hole-2-laser-3,
  // *thunderRelativeBait* dist:0 for both tanks) takes over: both mt and ot resolve to exdeath's
  // exact current position regardless of the frame's north direction.
  world = runTicksWithComputedBotIntents(world, Math.ceil((91 - world.time) * 60));
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

    // Every dodge spot is r:-7 (party) or r:-14 (ot) lateral to Kefka's beam, z:-7 along it, so
    // its distance from arena centre is hypot(r,7); mirrorLateral/mirrorForward guarantee it's
    // also outside both Look Upon Me's rect and Damning Edict 2's cone for whichever random
    // target got baited, verified directly against the engine's own containment check rather
    // than re-deriving the geometry by hand.
    const edict = world.active.find(m => m.id === "damning-edict-2-store")!;
    expect(edict.shape.kind).toBe("cone");
    const expectedDist: Record<string, number> = { mt: Math.hypot(7, 7), h1: Math.hypot(7, 7), r2: Math.hypot(7, 7), ot: Math.hypot(14, 7) };
    for (const id of Object.keys(expectedDist)) {
      const target = genericSolverWaypoint(byId(world, id), world)!;
      expect(target).toBeDefined();
      expect(length(target)).toBeCloseTo(expectedDist[id], 6);
      expect(pointInShape(shape, target)).toBe(false); // safe from Look Upon Me
      expect(pointInShape(edict.shape, target)).toBe(false); // safe from Damning Edict 2
    }
  }
});

// The wave-10 healer solos Black Hole 4's delayed tether while Look Upon Me 2 (a line cleave from
// bigkefka through arena centre) resolves. Its nearestEdge rule sends it to the closest wall point,
// to its east tether orb, that stays clear of that line - so this must hold for every teleport
// outcome (which rotates the line), not just one. The non-soloing healer falls to the party dodge
// far nearer centre, so the soloer is the healer nearestEdge pushes out to the wall.
test("the wave-10 soloing healer's Look Upon Me 2 edge dodge clears the line for any teleport outcome", async () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
    const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
    const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
    // Sample at t=147: past the earlier {r:0,z:17} orb-approach rule (endAt 146) so nearestEdge is
    // the winning rule, and inside Look Upon Me 2's live window (144-148).
    const world = runTicksWithComputedBotIntents(createWorld(raid, seed), Math.ceil(147 * 60));

    const lookUponMe = world.active.find(m => m.id === "look-upon-me-2");
    expect(lookUponMe).toBeDefined();
    const shape = lookUponMe!.shape;
    if (shape.kind !== "rect") throw new Error("expected look-upon-me-2 to be a rect shape");

    const soloTarget = ["h1", "h2"]
      .map(id => genericSolverWaypoint(byId(world, id), world))
      .find(target => target !== undefined && length(target) > 15);
    expect(soloTarget).toBeDefined();
    expect(length(soloTarget!)).toBeCloseTo(20, 3);      // parked on the wall
    expect(pointInShape(shape, soloTarget!)).toBe(false); // and clear of Look Upon Me's line
  }
});

test("Damning Edict 2 dodge survives chaos's facing landing parallel/antiparallel to bigkefka's", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

  // This is exactly the configuration the old z:0 spots failed on: right.chaosFacing collapses to
  // 0 whenever chaos's locked facing is parallel/antiparallel to bigkefka's, so mirrorLateral alone
  // gives zero margin - only mirrorForward's z term keeps these spots Edict-safe here.
  for (const chaosFacing of [0, Math.PI]) {
    const base = createWorld(raid, 1);
    base.time = 87; // inside the dodge rule's 85.3-94.1 window
    base.bosses = base.bosses.map(b =>
      b.id === "bigkefka" ? { ...b, facing: 0 }
      : b.id === "chaos" ? { ...b, facing: chaosFacing }
      : b);
    const chaosFacingVec = { x: sin(chaosFacing), z: cos(chaosFacing) };

    for (const id of ["mt", "h1", "h2", "r1", "r2", "m1", "m2", "ot"]) {
      const target = genericSolverWaypoint(byId(base, id), base)!;
      expect(target).toBeDefined();
      // A real safety margin, not the boundary the cone's inclusive dot>=0 test requires.
      expect(dot(target, chaosFacingVec)).toBeLessThan(-1);
    }
  }
});

test("the party's post-Edict dodge spot doesn't jitter when chaos re-faces after t=89", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

  // Damning Edict 2's own facing lock only holds through its resolve at t=89 (see aoe.ts's bait
  // promotion); past that, chaos resumes turning to face its current top-threat target every tick.
  // Once the lock has lifted, the party's dodge spot must no longer depend on chaos's (now just
  // drifting) facing - it should land in the same place regardless of which way chaos has turned.
  const targetsByChaosFacing = [0, Math.PI / 2, Math.PI].map(chaosFacing => {
    const base = createWorld(raid, 1);
    base.time = 89.5; // past Edict 2's lock (ends t=89), still inside Look Upon Me's window (86-90)
    base.bosses = base.bosses.map(b =>
      b.id === "bigkefka" ? { ...b, facing: 0 }
      : b.id === "chaos" ? { ...b, facing: chaosFacing }
      : b);
    return Object.fromEntries(
      ["mt", "h1", "h2", "r1", "r2", "m1", "m2"].map(id => [id, genericSolverWaypoint(byId(base, id), base)]),
    );
  });

  for (const id of ["mt", "h1", "h2", "r1", "r2", "m1", "m2"]) {
    for (const targets of targetsByChaosFacing) expect(targets[id]).toBeDefined();
    expect(targetsByChaosFacing[1]![id]).toEqual(targetsByChaosFacing[0]![id]);
    expect(targetsByChaosFacing[2]![id]).toEqual(targetsByChaosFacing[0]![id]);
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
    expect(hasDebuff(accretionCarrier, "NonAccretion Duty")).toBe(false);
    expect(hasDebuff(dpsHandoff, "NonAccretion Duty")).toBe(true);

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
