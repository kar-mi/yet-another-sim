import { expect, test } from "bun:test";
import { pointInShape } from "../shapes";
import { preRollRaid } from "../preRoll";
import { loadRaid } from "../raidLoader";
import { createWorld } from "../world";
import { toAOEShape } from "../eventTransforms";
import { isFloorAoeVisible } from "@shared/floorAoe";
import { describeDecisions, validateRngConstraints } from "../seedSearch";
import { HUMAN, byId, roster, runTicks } from "./helpers";

const rawRaid = Bun.YAML.parse(await Bun.file(`${import.meta.dir}/../../../raids/forked-tower-magic/omni-elements-1.yaml`).text());
const raid = loadRaid(rawRaid);

// The pair polygon flush with the north edge, as authored in the raid file.
const northPair = { kind: "polygon" as const, vertices: [[-3.233, 5.6], [3.233, 5.6], [7.506, 13], [7.506, 28.011], [-7.506, 28.011], [-7.506, 13]].map(([x, z]) => ({ x: x!, z: z! })) };

type Wave = { id: string; name: string; t: number; telegraph: number };

function wavesForSeed(seed: number, round: "r1" | "r2"): Wave[] {
  return preRollRaid(raid, seed).events
    .filter((e): e is typeof e & Wave => e.id.startsWith(round) && "t" in e && "telegraph" in e)
    .sort((a, b) => a.t - b.t);
}

function waveOrder(seed: number, round: "r1" | "r2") {
  const byTime = new Map<number, string>();
  for (const wave of wavesForSeed(seed, round)) byTime.set(wave.t, wave.name);
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([, name]) => name);
}

test("each round fires six waves, two per element", () => {
  for (const round of ["r1", "r2"] as const) {
    const order = waveOrder(3, round);
    expect(order).toHaveLength(6);
    for (const element of ["Fire IV", "Blizzard IV", "Thunder IV"]) {
      expect(order.filter(name => name === element)).toHaveLength(2);
    }
  }
});

test("wave order is two permutations with no repeat across the join, and varies by seed", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 25; seed++) {
    for (const round of ["r1", "r2"] as const) {
      const order = waveOrder(seed, round);
      expect(new Set(order.slice(0, 3)).size).toBe(3);
      expect(new Set(order.slice(3)).size).toBe(3);
      expect(order[2]).not.toBe(order[3]!);
      seen.add(order.join(","));
    }
  }
  expect(seen.size).toBeGreaterThan(4);
});

test("an element keeps its pair for the whole pull", () => {
  const events = preRollRaid(raid, 8).events;
  const pairOf = new Map<string, string>();
  for (const event of events) {
    const pair = event.id.split("-")[1];
    if (!pair || !/^r[12][ab]-/.test(event.id)) continue;
    const seen = pairOf.get(event.name);
    if (seen === undefined) pairOf.set(event.name, pair);
    else expect(pair).toBe(seen);
  }
  expect(pairOf.size).toBe(3);
});

test("a wave damages what stands on its pair and spares the rest of the arena", () => {
  const seed = 3;
  const waves = wavesForSeed(seed, "r1");
  const first = waves[0]!;
  const onFirstPair = first.id.includes("-ns-") ? [0, 20.5] : first.id.includes("-nesw-") ? [17.76, 10.25] : [17.76, -10.25];
  const world = createWorld({
    ...raid,
    players: roster({ m1: { spawn: onFirstPair as [number, number] }, m2: { spawn: [0, 9] } }),
  }, seed);

  const stood = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, Math.ceil((first.t + first.telegraph + 0.2) * 60));
  // Everyone has already eaten the 20-damage opening raidwide by now.
  expect(byId(stood, "m1").hp).toBe(40);
  const hitPairs = waves.filter(w => w.t === first.t).map(w => w.id.split("-")[1]);
  if (!hitPairs.includes("ns")) expect(byId(stood, "m2").hp).toBe(80);
});

test("pointInShape handles the authored pair polygon", () => {
  expect(pointInShape(northPair, { x: 0, z: 20 })).toBe(true);   // on the square platform
  expect(pointInShape(northPair, { x: 0, z: 9 })).toBe(true);    // on the trapezoid
  expect(pointInShape(northPair, { x: 0, z: 0 })).toBe(false);   // the central hole
  expect(pointInShape(northPair, { x: 12, z: 9 })).toBe(false);  // the neighbouring pair
  expect(pointInShape(northPair, { x: 0, z: 30 })).toBe(false);  // beyond the platform
});

test("each round selects exactly one of bow or harp", () => {
  const kinds = new Set<string>();
  const counts = { bow: 6, harp: 1 };
  for (let seed = 1; seed <= 40; seed++) {
    const events = preRollRaid(raid, seed).events;
    for (const round of ["1", "2"]) {
      const selected = Object.entries(counts).filter(([kind]) => events.some(e => e.id.startsWith(`${kind}${round}`)));
      expect(selected).toHaveLength(1);
      const [kind, count] = selected[0]!;
      expect(events.filter(e => e.id.startsWith(`${kind}${round}`))).toHaveLength(count);
      kinds.add(kind);
    }
  }
  expect(kinds).toEqual(new Set(Object.keys(counts)));
});

test("implement footprints match the circle references", () => {
  const directions = [0, 60, 120, 180, 240, 300];
  const at = (degrees: number, radius: number) => ({ x: Math.sin(degrees * Math.PI / 180) * radius, z: Math.cos(degrees * Math.PI / 180) * radius });
  for (const round of [1, 2]) {
    const shapes = (kind: string) => raid.events.flatMap(event => event.type === "aoe" && event.id.startsWith(`${kind}${round}`) ? [toAOEShape(event.shape)] : []);
    const hits = (kind: string, degrees: number, radius: number) => shapes(kind).some(shape => pointInShape(shape, at(degrees, radius)));
    expect(shapes("bow").every(shape => shape.kind === "circle")).toBe(true);
    expect(shapes("harp").every(shape => shape.kind === "circle")).toBe(true);
    for (const degrees of directions) {
      expect(hits("bow", degrees, 20.506)).toBe(true);
      expect(hits("bow", degrees, 8)).toBe(false);
      expect(hits("harp", degrees, 9)).toBe(true);
      expect(hits("harp", degrees, 20.506)).toBe(false);
    }
  }
});

test("waves are hidden until the final 0.4 seconds and disappear after impact", () => {
  const first = wavesForSeed(3, "r1")[0]!;
  let world = createWorld(raid, 3);
  world = runTicks(world, {}, Math.ceil((first.t + 0.1) * 60));
  const visual = world.active.find(event => event.id === first.id)!.floorAoe!;
  const resolveAt = first.t + first.telegraph;
  expect(isFloorAoeVisible(visual, first.t + 0.1, false)).toBe(false);
  expect(isFloorAoeVisible(visual, resolveAt - 0.401, false)).toBe(false);
  expect(isFloorAoeVisible(visual, resolveAt - 0.399, false)).toBe(true);
  expect(isFloorAoeVisible(visual, resolveAt, false)).toBe(true);
  expect(isFloorAoeVisible(visual, resolveAt + 0.001, true)).toBe(false);
});

test("a ring platform only hits carriers of its own element", () => {
  // Fire is safe (ring players carry Blizzard + Thunder); N/S is Fire, NE/SW Blizzard, SE/NW Thunder.
  const constraints = { "event-set-ring-1": 0, "label-pairs-0": 2, "label-pairs-1": 0, "label-pairs-2": 1 };
  const world = createWorld({
    ...raid,
    events: raid.events.filter(event => event.id.startsWith("ring1-")),
    optionals: { towerRng: false, combinations: {
      labels: raid.optionals!.combinations!.labels,
      eventSets: { "ring-1": raid.optionals!.combinations!.eventSets!["ring-1"]! },
    } },
    players: roster({ m1: { spawn: [0, 20.5] }, ot: { spawn: [17.76, 10.25] }, h1: { spawn: [17.76, -10.25] } }),
  }, 3, constraints);
  const after = runTicks(world, {}, 34 * 60);
  expect(byId(after, "m1").alive).toBe(true);
  expect(byId(after, "m1").hp).toBe(byId(after, "m1").maxHp);
  expect(byId(after, "ot").alive).toBe(false);
  expect(byId(after, "h1").alive).toBe(false);
});

test("the invisible opening cast keeps the boss stationary and facing north between attacks", () => {
  // Isolate the lock so damaging casts/markers cannot provide an accidental facing lock,
  // and the tank remains alive to pull the boss if the lock ends early.
  const world = runTicks(createWorld({
    ...raid,
    events: raid.events.filter(event => ["place-index", "keep-boss-still"].includes(event.id)),
    optionals: undefined,
    players: roster({ mt: { spawn: [17.759, 10.253] } }),
  }, 3), {}, 54 * 60);
  expect(world.bosses[0]!.pos).toEqual({ x: 0, z: 0 });
  expect(world.bosses[0]!.facing).toBe(0);
  const lock = world.active.find(event => event.id === "keep-boss-still")!;
  expect(lock.resolved).toBe(false);
  expect(lock.resolveAt).toBe(82);
  expect(lock.showCastBar).toBe(false);
  expect(lock.floorAoe).toBeUndefined();
});

test("all Omni RNG choices can be validated, forced and replayed", () => {
  const rolled = preRollRaid(raid, 3);
  const descriptions = describeDecisions(raid);
  expect(descriptions.map(choice => choice.key).sort()).toEqual(Object.keys(rolled.decisions).sort());
  expect(validateRngConstraints(raid, rolled.decisions)).toEqual(rolled.decisions);
  expect(preRollRaid(raid, 99, rolled.decisions).events).toEqual(rolled.events);
  for (const choice of descriptions) {
    for (let value = 0; value < choice.options.length; value++) {
      const constraints = { [choice.key]: value };
      expect(validateRngConstraints(raid, constraints)).toEqual(constraints);
      const forced = preRollRaid(raid, 3, constraints);
      expect(forced.decisions[choice.key]).toBe(value);
      expect(forced.rngState).toBe(rolled.rngState);
    }
    expect(validateRngConstraints(raid, { [choice.key]: choice.options.length })).toBeNull();
  }
  for (let value = 0; value < 2; value++) {
    const kind = ["bow", "harp"][value]!;
    for (const round of [1, 2]) {
      const forced = preRollRaid(raid, 3, { [`event-set-implement-${round}`]: value });
      expect(forced.events.some(event => event.id.startsWith(`${kind}${round}`))).toBe(true);
    }
  }
  expect(validateRngConstraints(raid, { "label-pairs-0": 0, "label-pairs-1": 0 })).toBeNull();
});
