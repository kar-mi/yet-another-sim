import { expect, test } from "bun:test";
import { WAYMARK_PRESETS } from "@shared/waymarkPresets";
import { tick } from "../sim";
import { atan2 } from "@shared/dmath";
import { preRollRaid } from "../preRoll";
import { loadRaid } from "../raidLoader";
import { validateRngConstraints } from "../seedSearch";
import { resolveEffectRef } from "../status/registry";
import { applyEffect } from "../systems/helpers";
import { createWorld } from "../world";
import { baseRaid, human, loadRaid as loadTestRaid, noMove, roster, runTicks } from "./helpers";

const rawRaid = Bun.YAML.parse(await Bun.file(`${import.meta.dir}/../../../raids/forked-tower-magic/fertile-ground.yaml`).text());
const raid = loadRaid(rawRaid);

function statusFixture() {
  const world = createWorld(loadRaid(baseRaid), 1);
  const player = human(world);
  let id = 0;
  return {
    world,
    player,
    apply(ref: string, behavior?: Record<string, unknown>) {
      applyEffect(world, player, resolveEffectRef({ ref, behavior })!, `hit-${id++}`, world.players);
    },
  };
}

test("opposite colors swap without damage or Ruin; repeats retain the color and escalate Ruin", () => {
  const { world, player, apply } = statusFixture();
  apply("growing_dread");
  apply("growing_panic");
  expect(player.hp).toBe(player.maxHp);
  expect(player.effects.map(effect => effect.name)).toEqual(["Growing Panic"]);
  const color = player.effects[0];
  apply("growing_panic");
  expect(player.hp).toBe(player.maxHp - 20);
  expect(player.effects[0]).toBe(color);
  expect(player.effects.find(effect => effect.name === "Thrice Come Ruin")?.stacks).toBe(1);
  apply("growing_dread");
  apply("growing_dread");
  expect(player.alive).toBe(true);
  expect(player.effects.find(effect => effect.name === "Thrice Come Ruin")?.stacks).toBe(2);
  apply("growing_dread");
  expect(player.alive).toBe(false);
  expect(player.effects.find(effect => effect.name === "Thrice Come Ruin")?.stacks).toBe(3);
  expect(world.log).toContainEqual(expect.objectContaining({ mechanic: "Thrice Come Ruin", event: "avoidableHit" }));
});

test("alternation keys and expired effects do not interfere with another color", () => {
  const { world, player, apply } = statusFixture();
  apply("growing_dread");
  apply("growing_panic", { alternationKey: "another-mechanic" });
  expect(player.effects).toHaveLength(2);
  expect(player.hp).toBe(player.maxHp);
  world.time = 1000;
  apply("growing_dread");
  expect(player.hp).toBe(player.maxHp);
  expect(player.effects.some(effect => effect.name === "Thrice Come Ruin")).toBe(false);
});

test("alternating repeat damage respects invincibility while Ruin still stacks", () => {
  const { player, apply } = statusFixture();
  player.invincible = true;
  for (let i = 0; i < 4; i++) apply("growing_dread");
  expect(player.hp).toBe(player.maxHp);
  expect(player.alive).toBe(true);
  expect(player.effects.find(effect => effect.name === "Thrice Come Ruin")?.stacks).toBe(3);
});

test("head groups rotate through separate rings deterministically without rewriting their spawns", () => {
  const sequence = raid.optionals!.headSequence!;
  const layouts = new Set<string>();
  const elements = new Set<number>();
  const firstGroups = new Set<number>();
  const directions = new Set<number>();
  for (let seed = 1; seed <= 64; seed++) {
    const rolled = preRollRaid(raid, seed);
    expect(preRollRaid(raid, seed)).toEqual(rolled);
    const moves = sequence.events.map(id => rolled.events.find(event => event.id === id)!);
    const spots = moves.map(event => {
      if (event.type !== "teleport_boss") throw new Error("Expected teleport");
      return event.spots[0];
    });
    expect(new Set(spots.map(spot => JSON.stringify(spot))).size).toBe(8);
    for (let group = 0; group < 2; group++) {
      const groupSpots = spots.slice(group * 4, group * 4 + 4);
      const ring = groupSpots[0][0] === 0 || groupSpots[0][1] === 0 ? sequence.cardinals : sequence.intercards;
      const indices = groupSpots.map(spot => ring.findIndex(candidate => candidate[0] === spot[0] && candidate[1] === spot[1]));
      expect(indices.every(index => index >= 0)).toBe(true);
      const step = (indices[1] - indices[0] + 4) % 4;
      expect([1, 3]).toContain(step);
      expect((indices[2] - indices[1] + 4) % 4).toBe(step);
      expect((indices[3] - indices[2] + 4) % 4).toBe(step);
    }
    expect(rolled.events.filter(event => event.id.startsWith("spawn-head-"))).toEqual(raid.events.filter(event => event.id.startsWith("spawn-head-")));
    expect(rolled.events.filter(event => event.id.startsWith("beam-"))).toHaveLength(16);
    expect(rolled.events.filter(event => /^(ice|thunder|fire)-/.test(event.id))).toHaveLength(9);
    layouts.add(JSON.stringify(spots));
    elements.add(rolled.decisions["event-set-elements"]);
    firstGroups.add(rolled.decisions["head-sequence-first"]);
    directions.add(rolled.decisions["head-sequence-group-1-direction"]);
  }
  expect(layouts.size).toBeGreaterThan(16);
  expect(elements.size).toBe(6);
  expect(firstGroups.size).toBe(2);
  expect(directions.size).toBe(2);
});

test("head sequence controls validate and disabled randomness uses the canonical order", () => {
  const constraints = { "head-sequence-first": 1, "head-sequence-group-1-start": 2, "head-sequence-group-1-direction": 1 };
  expect(validateRngConstraints(raid, constraints)).toEqual(constraints);
  expect(preRollRaid(raid, 1, constraints).decisions).toMatchObject(constraints);
  const fixed = { ...raid, optionals: { ...raid.optionals!, headSequence: { ...raid.optionals!.headSequence!, rng: false } } };
  const moves = (seed: number) => preRollRaid(fixed, seed).events.filter(event => event.id.startsWith("move-head-"));
  expect(moves(1)).toEqual(moves(42));
});

test("Fertile Ground splits colors evenly and heads spawn outward, move clockwise, then hold inward facing through the encounter", () => {
  let world = createWorld(raid, 42);
  world.players.forEach(player => { player.invincible = true; });
  expect(world.bosses[0].model).toBe("exdeath");
  expect(world.bosses.slice(1).every(boss => boss.hidden && boss.model === "dragon_head")).toBe(true);
  world = runTicks(world, noMove, 8 * 60);
  for (const name of ["Growing Dread", "Growing Panic"]) {
    expect(world.players.filter(player => player.effects.some(effect => effect.name === name))).toHaveLength(4);
  }
  world = runTicks(world, noMove, 3 * 60);
  for (const [i, head] of world.bosses.slice(1).entries()) {
    expect(head.hidden).toBe(false);
    expect(head.facing).toBeCloseTo(i * Math.PI / 4);
    expect(head.pos.x).toBeCloseTo(5 * Math.sin(head.facing), 3);
    expect(head.pos.z).toBeCloseTo(5 * Math.cos(head.facing), 3);
  }
  for (let i = 0; i < 8; i++) {
    const targetTime = 27.4 + 1.2 * i;
    world = runTicks(world, noMove, Math.ceil((targetTime - world.time) * 60));
    const heads = world.bosses.slice(1);
    expect(heads.filter(head => Math.hypot(head.pos.x, head.pos.z) > 17)).toHaveLength(i + 1);
    const head = heads[i];
    expect(head.facing).toBe(atan2(-head.pos.x, -head.pos.z));
    expect(head.currentTarget).toBeNull();
  }
  const heads = world.bosses.slice(1).map(head => ({ pos: head.pos, facing: head.facing }));
  world = runTicks(world, noMove, Math.ceil((raid.duration + 0.1 - world.time) * 60));
  expect(world.bosses.slice(1).map(head => ({ pos: head.pos, facing: head.facing }))).toEqual(heads);
  expect(world.pendingBossTeleports).toHaveLength(0);
  expect(world.time).toBeGreaterThanOrEqual(raid.duration);
});

test("a north head's beam applies blue east and purple west, swapping opposite colors without punishment", () => {
  let world = createWorld(raid, 42, {
    "head-sequence-first": 0,
    "head-sequence-group-1-start": 0,
    "event-set-beam-1": 0,
  });
  world.players.forEach(player => { player.invincible = true; });
  world = runTicks(world, noMove, 42 * 60);
  for (const [i, player] of world.players.entries()) {
    player.pos = { x: i % 2 === 0 ? 5 : -5, z: i < 4 ? 18 : -18 };
    player.effects = [];
    applyEffect(world, player, resolveEffectRef({ ref: i % 2 === 0 ? "growing_panic" : "growing_dread" })!, `color-${i}`, world.players);
  }
  world = runTicks(world, noMove, 72);
  for (const [i, player] of world.players.entries()) {
    expect(player.effects.map(effect => effect.name)).toEqual([i % 2 === 0 ? "Growing Dread" : "Growing Panic"]);
  }
  expect(world.log.filter(entry => entry.event === "avoidableHit")).toHaveLength(0);
});

test("Necrophobia stays targetable at center while heads remain off the boss list", () => {
  let world = createWorld(raid, 42);
  world.players.forEach(player => { player.invincible = true; });
  expect(world.bosses.filter(boss => boss.showInBossList !== false).map(boss => boss.id)).toEqual(["necrophobia"]);
  world = tick(world, noMove, 1 / 60);
  world.players.find(player => player.id === "mt")!.pos = { x: 12, z: 0 };
  const ticks = Math.floor((raid.duration - world.time) * 60) - 1;
  for (let i = 0; i < ticks; i++) {
    world = tick(world, noMove, 1 / 60);
    expect(world.bosses[0].pos).toEqual({ x: 0, z: 0 });
    expect(world.bosses[0].facing).toBe(0);
  }
  expect(world.bosses[0].targetable).toBe(true);
  expect(world.bosses[0].currentTarget).not.toBeNull();
});

test("Necrophobia waymark preset matches raid defaults and the exported orientation", () => {
  const marks = createWorld(raid, 1).waymarks;
  expect(WAYMARK_PRESETS.find(preset => preset.id === "necrophobia")?.marks).toEqual(marks);
  expect(marks.find(mark => mark.mark === "A")?.pos).toEqual({ x: 0, z: 14.6667 });
  expect(marks.find(mark => mark.mark === "1")?.pos).toEqual({ x: -7.3333, z: 11 });
});

function sideOrbRaid(laser: Record<string, unknown> = {}, teleport: Record<string, unknown> = {}) {
  return {
    ...baseRaid,
    players: roster(),
    bosses: [
      { id: "necrophobia", preset: "exdeath", pos: [0, 0] },
      { id: "head-1", preset: "severing_head", pos: [0, 0] },
    ],
    events: [
      { id: "move-head-1", type: "teleport_boss", time: 1, name: "Heads Roll", bossId: "head-1", spots: [[0, 18]] },
      { id: "move-other", type: "teleport_boss", time: 1, name: "Heads Roll", bossId: "necrophobia", spots: [[0, 0]] },
      {
        id: "laser", type: "aoe", time: 5, name: "Sowing Fear", bossId: "head-1", telegraph: 1,
        damage: 0, damageType: "magical", showCastBar: false, directionFrom: "bossFacing",
        directionOffset: -Math.PI / 2, color: "#3aa0ff", sideOrbAfter: "move-head-1",
        shape: { kind: "cone", origin: [0, 0], angleDeg: 180, length: 20 },
        ...laser,
      },
      ...(Object.keys(teleport).length > 0 ? [{ ...teleport }] : []),
    ],
  };
}

test("sideOrbAfter requires a coloured boss-facing cleave linked to an earlier teleport of its own boss", () => {
  expect(() => loadTestRaid(sideOrbRaid())).not.toThrow();
  expect(() => loadTestRaid(sideOrbRaid({ directionOffset: Math.PI / 2 }))).not.toThrow();
  expect(() => loadTestRaid(sideOrbRaid({ sideOrbAfter: "missing" }))).toThrow(/must reference a teleport_boss event/);
  expect(() => loadTestRaid(sideOrbRaid({ sideOrbAfter: "move-other" }))).toThrow(/moves boss/);
  expect(() => loadTestRaid(sideOrbRaid({ bossId: undefined }))).toThrow(/must name the boss/);
  expect(() => loadTestRaid(sideOrbRaid({ color: undefined }))).toThrow(/must define the orb color/);
  expect(() => loadTestRaid(sideOrbRaid({ directionOffset: Math.PI }))).toThrow(/directionOffset of -PI\/2/);
  expect(() => loadTestRaid(sideOrbRaid({ directionFrom: undefined }))).toThrow(/bossFacing/);
  expect(() => loadTestRaid(sideOrbRaid({ time: 0.5 }))).toThrow(/no later than the aoe it annotates/);
});

test("every head keeps one orb-annotated beam per side, coloured by the selected branch", () => {
  for (const seed of [1, 7, 42, 99]) {
    const { events, decisions } = preRollRaid(raid, seed);
    const beams = events.filter(event => event.id.startsWith("beam-"));
    expect(beams).toHaveLength(16);

    for (let head = 1; head <= 8; head++) {
      const annotated = beams.filter(event => event.type === "aoe" && event.bossId === `head-${head}`);
      expect(annotated.map(event => event.type === "aoe" && event.sideOrbAfter)).toEqual([`move-head-${head}`, `move-head-${head}`]);
      const sides = annotated.map(event => (event.type === "aoe" ? { offset: event.directionOffset, color: event.color } : null));
      const branch = decisions[`event-set-beam-${head}`] === 0 ? "a" : "b";
      expect(sides).toEqual([
        { offset: branch === "a" ? -Math.PI / 2 : Math.PI / 2, color: "#3aa0ff" },
        { offset: branch === "a" ? Math.PI / 2 : -Math.PI / 2, color: "#a855f7" },
      ]);
    }
  }
});
