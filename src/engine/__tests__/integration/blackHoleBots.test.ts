import { expect, test } from "bun:test";
import { add, dot, length, normalize, scale, sub } from "@shared/math";
import { cos, sin } from "@shared/dmath";
import { genericFrameNorth, genericSolverWaypoint, TETHER_SOURCE_PULL } from "../../genericSolver";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../../raidLoader";
import { pointInShape } from "../../shapes";
import { createWorld } from "../../world";
import { clockwiseTetherOrder } from "../../blackHoleOrbs";
import { byId, runTicksWithComputedBotIntents } from "../helpers";

// Mirrors the engine's polar-spot -> world conversion (src/engine/world.ts toSpot) for a given
// frame north/right and origin, so tests can independently pin the exact expected position.
function polarWorld(origin: { x: number; z: number }, north: { x: number; z: number }, dist: number, angleDeg: number) {
  const right = { x: north.z, z: -north.x };
  const angle = (angleDeg * Math.PI) / 180;
  return add(origin, add(scale(right, dist * sin(angle)), scale(north, dist * cos(angle))));
}

function clockwiseSoakWorld(source: { x: number; z: number }) {
  const north = normalize(source);
  const right = { x: north.z, z: -north.x };
  return add(scale(right, 9.44), scale(north, 3.44));
}

function pullTowardSource(aim: { x: number; z: number }, source: { x: number; z: number }) {
  const toSource = sub(source, aim);
  const dist = length(toSource);
  return dist <= TETHER_SOURCE_PULL ? source : add(aim, scale(normalize(toSource), TETHER_SOURCE_PULL));
}

test("black-hole raid and bot companion load with resolved tether frame positions", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
  const world = createWorld(raid, 1);

  expect(raid.botPatterns).toBe("black-hole-bots");
  expect(world.botSolvers?.generic?.length).toBeGreaterThan(0);
  expect(world.blackHoleTethers["black-hole-1"]!.positions).toHaveLength(3);
  expect(world.blackHoleTethers["black-hole-2"]!.orderFrom).toBe("bigkefka");
  expect(world.pendingTethers.filter(tether => tether.id.startsWith("black-hole-2-laser"))).toHaveLength(3);
});

test("Thunder III tankbusters are two closest-target hits three seconds apart", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text()) as { events: Array<{ id: string; time: number; telegraph: number; damage: number; targetMode: string }> };
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text()) as { solvers: { generic: Array<{ when?: { mechanic?: string } }> } };
  const events = raidData.events.filter((event: { id: string }) => event.id.startsWith("thunder-iii-tb-"));

  expect(events.map((event: { id: string; time: number; telegraph: number; damage: number; targetMode: string }) => ({
    id: event.id,
    resolveAt: event.time + event.telegraph,
    damage: event.damage,
    targetMode: event.targetMode,
  }))).toEqual([
    { id: "thunder-iii-tb-3-first", resolveAt: 9, damage: 50, targetMode: "closest" },
    { id: "thunder-iii-tb-3", resolveAt: 12, damage: 50, targetMode: "closest" },
    { id: "thunder-iii-tb-4-first", resolveAt: 50, damage: 50, targetMode: "closest" },
    { id: "thunder-iii-tb-4", resolveAt: 53, damage: 50, targetMode: "closest" },
    { id: "thunder-iii-tb-5-first", resolveAt: 91, damage: 50, targetMode: "closest" },
    { id: "thunder-iii-tb-5", resolveAt: 94, damage: 50, targetMode: "closest" },
  ]);

  const thunderRules = botData.solvers.generic.filter((rule: { when?: { mechanic?: string } }) => rule.when?.mechanic?.startsWith("thunder-iii-tb-"));
  expect(thunderRules.map(rule => rule.when!.mechanic!)).toEqual(events.map(event => event.id));
});

// Black Hole 2's tether order is locked clockwise from bigkefka's position at spawn (t=68, after
// kefka-teleport-1) and must stay fixed for the hazard's lifetime - kefka teleports again at t=84,
// mid-resolution (between the 80 and 85 fires), and that must NOT reshuffle the assignment.
test("Black Hole tether order is locked clockwise from Kefka at spawn and survives a mid-resolution teleport", async () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
    const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
    const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

    // Just after Black Hole 2 spawns and its first laser promotes (t=68), the order is locked.
    const atSpawn = runTicksWithComputedBotIntents(createWorld(raid, seed), Math.ceil(68.2 * 60));
    const kefkaAtSpawn = atSpawn.bosses.find(b => b.id === "bigkefka")!.pos;
    const physical = atSpawn.blackHoleTethers["black-hole-2"]!.positions;
    const locked = atSpawn.blackHoleTetherOrder["black-hole-2"];
    expect(locked).toEqual(clockwiseTetherOrder(physical, kefkaAtSpawn));

    // Past kefka-teleport-2 (t=84): kefka-teleport-2 has fired (it draws independently from the
    // same 8 fixed spots with no anti-repeat rule, so it may coincidentally land back on the spawn
    // spot - that's not itself a bug), but the locked order is unchanged regardless.
    const afterTeleport = runTicksWithComputedBotIntents(atSpawn, Math.ceil((85 - atSpawn.time) * 60));
    expect(afterTeleport.blackHoleTetherOrder["black-hole-2"]).toEqual(locked);
  }
});

test("black-hole bots survive the first Slap Happy side cleave", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
  const world = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(31.1 * 60));

  expect(world.status).toBe("running");
  expect(world.players.every(player => player.alive)).toBe(true);
});

// The partySafeEast / roleSafeWest dodge spots are center-based and oriented by Kefka's position.
// This guards that the formation stays clear of Kefka's radius-8 cleave circles, for either rolled
// cleave side, across all three Slap Happy waves (t~=29, 60, 132). Asserted via the damage log
// rather than mere survival, since recovery heals between mechanics would otherwise mask a caught hit.
test("center-based Kefka-oriented safe-spots keep the party clear of every Slap Happy cleave, all seeds", async () => {
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
  // Framed on the physical middle orb (a stable reference), not a Kefka-relative order slot.
  const north = genericFrameNorth([{ blackHoleOrb: { hazardId: "black-hole-1", index: 1 } }], world)!;
  const otTarget = genericSolverWaypoint(byId(world, "ot"), world)!;
  expect(otTarget).toEqual(polarWorld({ x: 0, z: 0 }, north, 12, 240));
  expect(otTarget).not.toEqual({ x: 0, z: 0 });
  expect(otTarget).not.toEqual({ x: 7, z: 0 });

  // third_in_line's non-dps member (mt or h1, see black-hole-tier-accretion) is untouched by this
  // change: it still resolves to the plain stack-middle spot.
  const thirdMember = ["mt", "h1"].find(id => byId(world, id).effects.some(e => e.name === "Third in Line"))!;
  expect(genericSolverWaypoint(byId(world, thirdMember), world)).toEqual({ x: 0, z: 0 });
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

  // Right after the override window ends, first_in_line's tank/healer member (mt or h1, see
  // black-hole-tier-accretion) resumes its Black Hole 2 laser-2 orb soak.
  const afterWorld = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(70.5 * 60));
  const firstMember = ["mt", "h1"].find(id => byId(afterWorld, id).effects.some(e => e.name === "First in Line"))!;
  const firstMemberTarget = genericSolverWaypoint(byId(afterWorld, firstMember), afterWorld);
  expect(firstMemberTarget).not.toEqual({ x: 0, z: 0 });
});

// Which literal dps ends up as first_in_line's untagged (NonAccretion Duty) member and which
// ends up as second_in_line's dps is picked per pull by black-hole-dps-tier-accretion (any of
// r1/r2/m1/m2 can land in either slot), so these must be resolved from debuffs, not hardcoded.
const DPS_SLOTS = ["r1", "r2", "m1", "m2"];
function hasEffect(world: ReturnType<typeof createWorld>, id: string, name: string) {
  return byId(world, id).effects.some(e => e.name === name);
}

test("Black Hole tether handoff aims at the live source-holder midpoint, then steals the tether", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

  // Sample at 76.1: past second_in_line's dps's brief *atOrb preposition window (75-76), so its
  // tetherMidpoint rule is now the winning one, but before it actually steals the tether (~76.6)
  // so first_in_line's untagged dps is still the holder.
  const during = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(76.1 * 60));
  const firstUntaggedDps = DPS_SLOTS.find(id => hasEffect(during, id, "First in Line") && hasEffect(during, id, "NonAccretion Duty"))!;
  const secondDps = DPS_SLOTS.find(id => hasEffect(during, id, "Second in Line"))!;
  const source = during.blackHoleTetherOrder["black-hole-2"]![0]!;
  const tether = during.tetherSources.find(ts => !ts.finalized && ts.pos.x === source.x && ts.pos.z === source.z)!;
  expect(tether.tetheredPlayerId).toBe(firstUntaggedDps);

  const holderId = tether.tetheredPlayerId;
  if (!holderId) throw new Error("expected a live tether holder");
  const holder = byId(during, holderId);
  expect(genericSolverWaypoint(byId(during, secondDps), during)).toEqual(scale(add(source, holder.pos), 0.5));

  const after = runTicksWithComputedBotIntents(during, Math.ceil((80.5 - during.time) * 60));
  const stolen = after.tetherSources.find(ts => !ts.finalized && ts.pos.x === source.x && ts.pos.z === source.z)!;
  expect(stolen.tetheredPlayerId).toBe(secondDps);
});

test("fresh Black Hole tether holder's merged rule heads to final soak", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

  const world = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(72 * 60));
  const firstUntaggedDps = DPS_SLOTS.find(id => hasEffect(world, id, "First in Line") && hasEffect(world, id, "NonAccretion Duty"))!;
  const source = world.blackHoleTetherOrder["black-hole-2"]![0]!;
  const tether = world.tetherSources.find(ts => !ts.finalized && ts.pos.x === source.x && ts.pos.z === source.z)!;
  expect(tether.tetheredPlayerId).toBe(firstUntaggedDps);
  expect(genericSolverWaypoint(byId(world, firstUntaggedDps), world)).toEqual(
    pullTowardSource(clockwiseSoakWorld(source), source),
  );
});

test("Black Hole tether holders stay stable after the handoff settles", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

  const settled = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(82.1 * 60));
  const sources = settled.blackHoleTetherOrder["black-hole-2"]!;
  const holders = sources.map(source =>
    settled.tetherSources.find(ts => !ts.finalized && ts.pos.x === source.x && ts.pos.z === source.z)?.tetheredPlayerId);
  expect(holders.every(Boolean)).toBe(true);

  const beforeFire = runTicksWithComputedBotIntents(settled, Math.ceil((84.8 - settled.time) * 60));
  expect(sources.map(source =>
    beforeFire.tetherSources.find(ts => !ts.finalized && ts.pos.x === source.x && ts.pos.z === source.z)?.tetheredPlayerId,
  )).toEqual(holders);
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

// The wave-10 soloer (third_in_line's non-dps member - mt or h1, see black-hole-tier-accretion)
// solos Black Hole 4's delayed tether while Look Upon Me 2 (a line cleave from bigkefka through
// arena centre) resolves. Its nearestEdge rule sends it to the closest wall point, to its east
// tether orb, that stays clear of that line - so this must hold for every teleport outcome (which
// rotates the line), not just one. The non-soloing players fall to the party dodge far nearer
// centre, so the soloer is whoever nearestEdge pushes out to the wall.
test("the wave-10 soloer's Look Upon Me 2 edge dodge clears the line for any teleport outcome", async () => {
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

    const soloTarget = ["mt", "h1", "h2"]
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
// Which 2 of the 4 dps (r1/r2/m1/m2) land in first_in_line, and which one of those carries
// Accretion (and so solos the 3rd tether instead of doing the 1st tether's hand-off), is picked
// by a seeded RNG eventSet (black-hole-dps-tier-accretion in black-hole.yaml), so this must hold
// regardless of which specific dps ends up in which tier/duty.
test("Black Hole tether assignments resolve correctly from debuffs regardless of which dps gets Accretion Duty", async () => {
  for (const seed of [1, 5]) {
    const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
    const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
    const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
    let world = runTicksWithComputedBotIntents(createWorld(raid, seed), Math.ceil(18 * 60));

    const hasDebuff = (id: string, name: string) => byId(world, id).effects.some(e => e.name === name);
    const firstDps = DPS_SLOTS.filter(id => hasDebuff(id, "First in Line"));
    const accretionCarrier = firstDps.find(id => hasDebuff(id, "Accretion Duty"))!;
    const dpsHandoff = firstDps.find(id => id !== accretionCarrier)!;
    const secondDps = DPS_SLOTS.find(id => hasDebuff(id, "Second in Line"))!;
    const thirdDps = DPS_SLOTS.find(id => hasDebuff(id, "Third in Line"))!;
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
    // switched carriers to h2 (second_in_line's healer) - first_in_line's dps are done for the fight.
    world = runTicksWithComputedBotIntents(world, Math.ceil((105 - 47) * 60));
    atCenter(dpsHandoff);
    atCenter(accretionCarrier);
    expect(hasDebuff("h2", "Accretion Duty")).toBe(true);
    notCenter(secondDps); // second_in_line's dps, doing the wave-6 hand-off
    notCenter("h2"); // second_in_line's healer, soloing Accretion's tether

    // wave 9 (t=138): DPS/Support chains have both reached third_in_line; its dps and its only
    // non-dps member (mt or h1, see black-hole-support-tier) are the ones active - no Accretion
    // carrier this late.
    world = runTicksWithComputedBotIntents(world, Math.ceil((138 - 105) * 60));
    const thirdMember = ["mt", "h1"].find(id => hasDebuff(id, "Third in Line"))!;
    notCenter(thirdDps);
    notCenter(thirdMember);
  }
});
