import { expect, test } from "bun:test";
import { add, dot, length, normalize, scale, sub } from "@shared/math";
import { cos, sin } from "@shared/dmath";
import { genericFrameNorth, genericSolverWaypoint, TETHER_SOURCE_PULL } from "../../bots/genericSolver";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../../schema/raidLoader";
import { pointInShape } from "../../shapes";
import { createWorld } from "../../world";
import { clockwiseTetherOrder } from "../../blackHoleOrbs";
import { byId, runTicksWithComputedBotIntents } from "../helpers";

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

test("Black Hole tether order is locked clockwise from Kefka at spawn and survives a mid-resolution teleport", async () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
    const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
    const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

    const atSpawn = runTicksWithComputedBotIntents(createWorld(raid, seed), Math.ceil(68.2 * 60));
    const kefkaAtSpawn = atSpawn.bosses.find(b => b.id === "bigkefka")!.pos;
    const physical = atSpawn.blackHoleTethers["black-hole-2"]!.positions;
    const locked = atSpawn.blackHoleTetherOrder["black-hole-2"];
    expect(locked).toEqual(clockwiseTetherOrder(physical, kefkaAtSpawn));

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

  const mtTarget = genericSolverWaypoint(byId(world, "mt"), world);
  expect(mtTarget).toBeDefined();

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

  const north = genericFrameNorth([{ blackHoleOrb: { hazardId: "black-hole-1", index: 1 } }], world)!;
  const otTarget = genericSolverWaypoint(byId(world, "ot"), world)!;
  expect(otTarget).toEqual(polarWorld({ x: 0, z: 0 }, north, 12, 240));
  expect(otTarget).not.toEqual({ x: 0, z: 0 });
  expect(otTarget).not.toEqual({ x: 7, z: 0 });

  const thirdMember = ["mt", "h1"].find(id => byId(world, id).effects.some(e => e.name === "Third in Line"))!;
  expect(genericSolverWaypoint(byId(world, thirdMember), world)).toEqual({ x: 0, z: 0 });
});

test("the party (tanks included) stays frozen on the LUM1 dodge spot through t=90.1, then tb-5's tank formation stands both tanks on exdeath's dragged position", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

  let world = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(90 * 60));
  expect(genericSolverWaypoint(byId(world, "mt"), world)).toEqual(byId(world, "mt").pos);
  expect(genericSolverWaypoint(byId(world, "ot"), world)).toEqual(byId(world, "ot").pos);

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

  const duringWorld = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(68.5 * 60));
  for (const id of ["mt", "r1", "m1", "h1"]) {
    expect(genericSolverWaypoint(byId(duringWorld, id), duringWorld)).toEqual({ x: 0, z: 0 });
  }

  const afterWorld = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(70.5 * 60));
  const firstMember = ["mt", "h1"].find(id => byId(afterWorld, id).effects.some(e => e.name === "First in Line"))!;
  const firstMemberTarget = genericSolverWaypoint(byId(afterWorld, firstMember), afterWorld);
  expect(firstMemberTarget).not.toEqual({ x: 0, z: 0 });
});

const DPS_SLOTS = ["r1", "r2", "m1", "m2"];
function hasEffect(world: ReturnType<typeof createWorld>, id: string, name: string) {
  return byId(world, id).effects.some(e => e.name === name);
}

test("Black Hole tether handoff aims at the live source-holder midpoint, then steals the tether", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

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

    const kefka = world.bosses.find(b => b.id === "bigkefka")!;
    const lookUponMe = world.active.find(m => m.id === "look-upon-me-1")!;
    const shape = lookUponMe.shape;
    if (shape.kind !== "rect") throw new Error("expected look-upon-me-1 to be a rect shape");
    const expectedDirection = normalize(scale(kefka.pos, -1));
    expect(shape.direction.x).toBeCloseTo(expectedDirection.x, 6);
    expect(shape.direction.z).toBeCloseTo(expectedDirection.z, 6);

    const edict = world.active.find(m => m.id === "damning-edict-2-store")!;
    expect(edict.shape.kind).toBe("cone");
    const expectedDist: Record<string, number> = { mt: Math.hypot(7, 7), h1: Math.hypot(7, 7), r2: Math.hypot(7, 7), ot: Math.hypot(14, 7) };
    for (const id of Object.keys(expectedDist)) {
      const target = genericSolverWaypoint(byId(world, id), world)!;
      expect(target).toBeDefined();
      expect(length(target)).toBeCloseTo(expectedDist[id], 6);
      expect(pointInShape(shape, target)).toBe(false);
      expect(pointInShape(edict.shape, target)).toBe(false);
    }
  }
});

test("the wave-10 soloer's Look Upon Me 2 edge dodge clears the line for any teleport outcome", async () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
    const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
    const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
    const world = runTicksWithComputedBotIntents(createWorld(raid, seed), Math.ceil(147 * 60));

    const lookUponMe = world.active.find(m => m.id === "look-upon-me-2");
    expect(lookUponMe).toBeDefined();
    const shape = lookUponMe!.shape;
    if (shape.kind !== "rect") throw new Error("expected look-upon-me-2 to be a rect shape");

    const soloTarget = ["mt", "h1", "h2"]
      .map(id => genericSolverWaypoint(byId(world, id), world))
      .find(target => target !== undefined && length(target) > 15);
    expect(soloTarget).toBeDefined();
    expect(length(soloTarget!)).toBeCloseTo(20, 3);
    expect(pointInShape(shape, soloTarget!)).toBe(false);
  }
}, 30_000);

test("Damning Edict 2 dodge survives chaos's facing landing parallel/antiparallel to bigkefka's", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

  for (const chaosFacing of [0, Math.PI]) {
    const base = createWorld(raid, 1);
    base.time = 87;
    base.bosses = base.bosses.map(b =>
      b.id === "bigkefka" ? { ...b, facing: 0 }
      : b.id === "chaos" ? { ...b, facing: chaosFacing }
      : b);
    const chaosFacingVec = { x: sin(chaosFacing), z: cos(chaosFacing) };

    for (const id of ["mt", "h1", "h2", "r1", "r2", "m1", "m2", "ot"]) {
      const target = genericSolverWaypoint(byId(base, id), base)!;
      expect(target).toBeDefined();
      expect(dot(target, chaosFacingVec)).toBeLessThan(-1);
    }
  }
});

test("the party's post-Edict dodge spot doesn't jitter when chaos re-faces after t=89", async () => {
  const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
  const botData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole-bots.yaml").text());
  const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

  const targetsByChaosFacing = [0, Math.PI / 2, Math.PI].map(chaosFacing => {
    const base = createWorld(raid, 1);
    base.time = 89.5;
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

    world = runTicksWithComputedBotIntents(world, Math.ceil((40 - 18) * 60));
    notCenter(dpsHandoff);
    atCenter(accretionCarrier);

    world = runTicksWithComputedBotIntents(world, Math.ceil((47 - 40) * 60));
    notCenter(dpsHandoff);
    atCenter(accretionCarrier);

    world = runTicksWithComputedBotIntents(world, Math.ceil((105 - 47) * 60));
    atCenter(dpsHandoff);
    atCenter(accretionCarrier);
    expect(hasDebuff("h2", "Accretion Duty")).toBe(true);
    notCenter(secondDps);
    notCenter("h2");

    world = runTicksWithComputedBotIntents(world, Math.ceil((138 - 105) * 60));
    const thirdMember = ["mt", "h1"].find(id => hasDebuff(id, "Third in Line"))!;
    notCenter(thirdDps);
    notCenter(thirdMember);
  }
});
