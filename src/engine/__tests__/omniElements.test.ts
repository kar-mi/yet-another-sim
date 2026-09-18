import { expect, test } from "bun:test";
import { pointInShape } from "../shapes";
import { preRollRaid } from "../preRoll";
import { loadRaid } from "../raidLoader";
import { createWorld } from "../world";
import { toAOEShape } from "../eventTransforms";
import { elementRingRadius } from "@shared/elementRing";
import { isFloorAoeVisible } from "@shared/floorAoe";
import { moverPosition } from "@shared/mover";
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

test("each wave pair is announced by one ring that reaches the square centers as it hits", () => {
  const glyphFor: Record<string, string> = { "Blizzard IV": "ice", "Thunder IV": "lightning", "Fire IV": "fire" };
  for (const round of ["r1", "r2"] as const) {
    const waves = preRollRaid(raid, 3).events.filter(e => e.type === "aoe" && /^r[12][ab]-/.test(e.id) && e.id.startsWith(round))
      .flatMap(e => e.type === "aoe" ? [e] : []);
    const byTime = new Map<number, typeof waves>();
    for (const e of waves) byTime.set(e.t, [...(byTime.get(e.t) ?? []), e]);
    expect(byTime.size).toBe(6);
    for (const pair of byTime.values()) {
      const ringed = pair.filter(e => e.ring);
      expect(ringed).toHaveLength(1);
      const wave = ringed[0]!;
      expect(wave.ring?.radius).toBe(20.506);
      expect(wave.ring?.kind).toBe(glyphFor[wave.name] as never);
      expect(wave.showCastBar).toBe(false);
    }
  }
  // Round 1's first ring leaves the boss as Elementary Expansion ends.
  expect(wavesForSeed(3, "r1")[0]!.t).toBe(10.12);
});

test("ring radius grows linearly over the cast and the pair only flashes in the final 0.4s", () => {
  const ring = { center: { x: 0, z: 0 }, radius: 20.506 };
  expect(elementRingRadius(ring, 10, 17.83, 9)).toBe(0);
  expect(elementRingRadius(ring, 10, 17.83, 10 + 7.83 / 2)).toBeCloseTo(10.253, 5);
  expect(elementRingRadius(ring, 10, 17.83, 17.83)).toBe(20.506);
  expect(elementRingRadius(ring, 10, 17.83, 30)).toBe(20.506);

  const first = wavesForSeed(3, "r1")[0]!;
  const world = runTicks(createWorld(raid, 3), {}, Math.ceil((first.t + 0.1) * 60));
  const active = world.active.filter(m => m.telegraphStart === first.t && /^r1[ab]-/.test(m.id));
  expect(active).toHaveLength(2);
  const resolveAt = first.t + first.telegraph;
  for (const m of active) {
    expect(isFloorAoeVisible(m.floorAoe!, first.t + 0.1, false)).toBe(false);
    expect(isFloorAoeVisible(m.floorAoe!, resolveAt - 0.401, false)).toBe(false);
    expect(isFloorAoeVisible(m.floorAoe!, resolveAt - 0.399, false)).toBe(true);
    expect(isFloorAoeVisible(m.floorAoe!, resolveAt + 0.001, true)).toBe(false);
  }
});

test("platform markers are outlines carrying their pair's element glyph until the Chemistry raidwide", () => {
  const glyphFor: Record<string, string> = { "Blizzard IV": "ice", "Thunder IV": "lightning", "Fire IV": "fire" };
  for (let seed = 1; seed <= 5; seed++) {
    const markers = preRollRaid(raid, seed).events.filter(e => e.id.startsWith("mark-"));
    expect(markers).toHaveLength(6);
    for (const marker of markers) {
      if (marker.type !== "aoe") throw new Error(`${marker.id} is not an aoe`);
      expect(marker.outline).toBe(true);
      expect(marker.glyph?.kind).toBe(glyphFor[marker.name] as never);
      expect(marker.t + marker.telegraph).toBeCloseTo(79.42, 5);
    }
  }
  const world = runTicks(createWorld(raid, 3), {}, 5 * 60);
  const north = world.active.find(m => m.id === "mark-n")!;
  expect(north.floorAoe?.style).toBe("outline");
  expect(north.glyph?.at).toEqual({ x: 0, z: 20.506 });
});

test("Cleansing orbs spawn in a trapezoid, then glide one section clockwise to detonate at 32.70", () => {
  const bearing = (p: { x: number; z: number }) => (Math.atan2(p.x, p.z) * 180 / Math.PI + 360) % 360;
  for (let seed = 1; seed <= 5; seed++) {
    const orbs = preRollRaid(raid, seed).events.flatMap(e => e.type === "aoe" && e.id.startsWith("orb-") ? [e] : []);
    expect(orbs.map(o => o.shape.kind).sort()).toEqual(["circle", "circle", "donut"]);
    for (const orb of orbs) {
      expect(orb.t).toBe(22.31);
      expect(orb.t + orb.telegraph).toBeCloseTo(32.7, 5);
      const shape = toAOEShape(orb.shape);
      if (shape.kind !== "circle" && shape.kind !== "donut") throw new Error("orb shape");
      const from = { x: orb.mover!.from[0], z: orb.mover!.from[1] };
      expect(Math.hypot(from.x, from.z)).toBeCloseTo(9.3, 2);                        // trapezoid middle
      expect((bearing(shape.center) - bearing(from) + 360) % 360).toBeCloseTo(60, 1); // one section clockwise
    }
  }
});

test("a mover sits until it departs, then arrives at its target exactly at resolve", () => {
  const mover = { from: { x: 0, z: 9.3 }, departAt: 27.7 };
  const to = { x: 17.759, z: 10.253 };
  expect(moverPosition(mover, to, 32.7, 22.31)).toEqual(mover.from);
  expect(moverPosition(mover, to, 32.7, 27.7)).toEqual(mover.from);
  const half = moverPosition(mover, to, 32.7, 30.2);
  expect(half.x).toBeCloseTo(8.8795, 4);
  expect(half.z).toBeCloseTo(9.7765, 4);
  expect(moverPosition(mover, to, 32.7, 32.7)).toEqual(to);
});

test("an onlyCarriers aoe only hits players carrying an effect of the same name", () => {
  const { optionals: _, sections: __, ...base } = rawRaid as Record<string, unknown>;
  const world = createWorld(loadRaid({
    ...base,
    events: [
      { id: "mark", type: "apply_effect", time: 1, name: "Fire IV", players: ["m1"], applyEffect: { ref: "fire_iv_ring", duration: 5 } },
      { id: "hit", type: "aoe", time: 1, name: "Fire IV", telegraph: 2, damage: 999, damageType: "true", onlyCarriers: true, shape: { kind: "circle", center: [0, 0], radius: 30 } },
    ],
  }), 3);
  const after = runTicks(world, {}, 4 * 60);
  expect(byId(after, "m1").alive).toBe(false);
  expect(byId(after, "m2").hp).toBe(byId(after, "m2").maxHp);
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
