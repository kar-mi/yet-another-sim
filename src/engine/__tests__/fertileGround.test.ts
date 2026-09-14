import { expect, test } from "bun:test";
import { atan2 } from "@shared/dmath";
import { preRollRaid } from "../preRoll";
import { loadRaid } from "../raidLoader";
import { validateRngConstraints } from "../seedSearch";
import { resolveEffectRef } from "../status/registry";
import { applyEffect } from "../systems/helpers";
import { createWorld } from "../world";
import { baseRaid, human, noMove, runTicks } from "./helpers";

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
    expect(head.pos.x).toBeCloseTo(3 * Math.sin(head.facing), 3);
    expect(head.pos.z).toBeCloseTo(3 * Math.cos(head.facing), 3);
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
    player.pos = { x: i % 2 === 0 ? 5 : -5, z: 0 };
    player.effects = [];
    applyEffect(world, player, resolveEffectRef({ ref: i % 2 === 0 ? "growing_panic" : "growing_dread" })!, `color-${i}`, world.players);
  }
  world = runTicks(world, noMove, 72);
  for (const [i, player] of world.players.entries()) {
    expect(player.effects.map(effect => effect.name)).toEqual([i % 2 === 0 ? "Growing Dread" : "Growing Panic"]);
  }
  expect(world.log.filter(entry => entry.event === "avoidableHit")).toHaveLength(0);
});
