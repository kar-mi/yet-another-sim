import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { DPS_HP } from "./constants";
import { baseRaid, loadRaid, roster, runTicks } from "./helpers";
import type { Vec } from "./helpers";

const inverseEvent = (over: Record<string, unknown> = {}) => ({
  type: "inverse" as const,
  t: 0.1,
  name: "Inverse",
  telegraph: 0.1,
  damage: 40,
  damageType: "magical" as const,
  shownShapes: [{ kind: "circle" as const, center: [10, 0] as Vec, radius: 3 }],
  hiddenShapes: [{ kind: "circle" as const, center: [-10, 0] as Vec, radius: 3 }],
  ...over,
});

test("inverse: an honest cast hits the shown shapes and spares the hidden shapes", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [10, 0] }, m2: { spawn: [-10, 0] } }),
    events: [inverseEvent()],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(0.3 * 60));
  expect(world.players.find(p => p.id === "m1")!.hp).toBe(60);
  expect(world.players.find(p => p.id === "m2")!.hp).toBe(DPS_HP);
});

test("inverse: a question-mark cast hits the hidden shapes and spares the shown shapes", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [10, 0] }, m2: { spawn: [-10, 0] } }),
    events: [inverseEvent({ questionMark: true })],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(0.3 * 60));
  expect(world.players.find(p => p.id === "m1")!.hp).toBe(DPS_HP);
  expect(world.players.find(p => p.id === "m2")!.hp).toBe(60);
});

test("inverse: a combo hits players standing in any lethal shape", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [10, 0] }, m2: { spawn: [0, 10] }, r1: { spawn: [-10, 0] } }),
    events: [inverseEvent({
      shownShapes: [
        { kind: "circle", center: [10, 0], radius: 3 },
        { kind: "circle", center: [0, 10], radius: 3 },
      ],
    })],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(0.3 * 60));
  expect(world.players.find(p => p.id === "m1")!.hp).toBe(60);
  expect(world.players.find(p => p.id === "m2")!.hp).toBe(60);
  expect(world.players.find(p => p.id === "r1")!.hp).toBe(DPS_HP);
});

test("inverse: applyEffect lands only on the lethal side", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [10, 0] }, m2: { spawn: [-10, 0] } }),
    events: [inverseEvent({
      questionMark: true,
      applyEffect: { ref: "magic_vulnerability" },
    })],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(0.3 * 60));
  expect(world.players.find(p => p.id === "m1")!.effects).toHaveLength(0);
  expect(world.players.find(p => p.id === "m2")!.effects.some(e => e.name === "Magic Vulnerability")).toBe(true);
});

test("inverse rng eventually picks both honest and inverted", () => {
  const raid = {
    ...baseRaid,
    players: roster({ m1: { spawn: [10, 0] }, m2: { spawn: [-10, 0] } }),
    events: [inverseEvent({ t: 0, telegraph: 1, rng: true })],
  };
  const seen = new Set<boolean>();
  for (let i = 0; i < 40; i++) {
    const w = tick(createWorld(loadRaid(raid)), {}, 1 / 60);
    seen.add(w.inversions[0].inverted);
  }
  expect(seen).toEqual(new Set([true, false]));
});

test("inverse variantRng rolls both orientations and makes the b shapes lethal when b is rolled", () => {
  const raid = {
    ...baseRaid,
    players: roster({ m1: { spawn: [10, 0] }, m2: { spawn: [0, 10] } }),
    events: [inverseEvent({
      t: 0, telegraph: 0.1, variantRng: true,
      shownShapes: [{ kind: "circle", center: [10, 0], radius: 3 }],
      hiddenShapes: [{ kind: "circle", center: [-10, 0], radius: 3 }],
      shownShapesB: [{ kind: "circle", center: [0, 10], radius: 3 }],
      hiddenShapesB: [{ kind: "circle", center: [0, -10], radius: 3 }],
    })],
  };
  const variants = new Set<boolean>();
  const deaths = new Set<string>();
  for (let i = 0; i < 60; i++) {
    let w = tick(createWorld(loadRaid(raid)), {}, 1 / 60);
    variants.add(w.inversions[0].variantB);
    w = runTicks(w, {}, Math.ceil(0.3 * 60));
    if (w.players.find(p => p.id === "m1")!.hp < 100) deaths.add("m1");
    if (w.players.find(p => p.id === "m2")!.hp < 100) deaths.add("m2");
  }
  expect(variants).toEqual(new Set([true, false]));
  expect(deaths).toEqual(new Set(["m1", "m2"]));
});
