import { expect, test } from "bun:test";
import { pointInShape } from "../shapes";
import { preRollRaid } from "../preRoll";
import { loadRaid } from "../raidLoader";
import { createWorld } from "../world";
import { toAOEShape } from "../eventTransforms";
import { elementRingRadius } from "@shared/elementRing";
import { isFloorAoeVisible } from "@effects";
import { moverPosition } from "@shared/mover";
import { countdownSlicesLeft } from "@shared/countdown";
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
      // The surviving Sealed Implements cast bar names the same implement, so the boss can outline it.
      expect(events.filter(e => e.id.startsWith(`sealed-implements-${round}-`)).map(e => e.id)).toEqual([`sealed-implements-${round}-${kind}`]);
      kinds.add(kind);
    }
  }
  expect(kinds).toEqual(new Set(Object.keys(counts)));
});

test("implements have no cast bar or telegraph, only an impact flash exactly as Sealed Implements ends", () => {
  const events = raid.events.flatMap(e => e.type === "aoe" && /^(bow|harp)[12]/.test(e.id) ? [e] : []);
  expect(events.length).toBe(14);
  for (const e of events) {
    expect(e.showCastBar).toBe(false);
    expect(e.telegraphMode).toBe("resolve");
  }
  const sealed = raid.events.flatMap(e => e.type === "aoe" && e.id.startsWith("sealed-implements-") ? [e] : []);
  const resolves = [...new Set(events.map(e => +(e.t + e.telegraph).toFixed(2)))].sort();
  expect(resolves).toEqual([37.66, 51.85]);
  expect(sealed).toHaveLength(4);
  for (const bar of sealed) {
    const round = Number(/^sealed-implements-([12])-/.exec(bar.id)![1]);
    const gap = resolves[round - 1]! - (bar.t + bar.telegraph);
    expect(gap).toBeCloseTo(0, 5);
  }
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

test("ring radius grows linearly over the cast and the pair only flashes on impact for 0.5s", () => {
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
    expect(isFloorAoeVisible(m.floorAoe!, resolveAt - 0.001, false)).toBe(false);
    expect(isFloorAoeVisible(m.floorAoe!, resolveAt + 0.499, true)).toBe(true);
    expect(isFloorAoeVisible(m.floorAoe!, resolveAt + 0.501, true)).toBe(false);
  }
});

test("every labelled platform aoe carries its pair's element onto its floor telegraph", () => {
  const glyphFor: Record<string, string> = { "Blizzard IV": "ice", "Thunder IV": "lightning", "Fire IV": "fire" };
  for (let seed = 1; seed <= 5; seed++) {
    const labelled = preRollRaid(raid, seed).events.filter(e => e.type === "aoe" && e.name in glyphFor);
    // 6 markers, 24 waves, 18 rings, and the 9 chemistry hits the `chemistry` event set keeps.
    expect(labelled.length).toBe(57);
    for (const e of labelled) {
      if (e.type !== "aoe") throw new Error(`${e.id} is not an aoe`);
      expect(e.element).toBe(glyphFor[e.name] as never);
    }
  }

  const first = wavesForSeed(3, "r1")[0]!;
  const world = runTicks(createWorld(raid, 3), {}, Math.ceil((first.t + 0.1) * 60));
  // The pair's second polygon has no glyph or ring, so this is the only way it learns its element.
  const pair = world.active.filter(m => m.telegraphStart === first.t && /^r1[ab]-/.test(m.id));
  expect(pair).toHaveLength(2);
  for (const m of pair) expect(m.floorAoe?.element).toBe(glyphFor[first.name] as never);
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

test("platform markers resolving at 79.42 do not cleanse Elementary Deficiency", () => {
  const source = rawRaid as {
    events: { id: string }[];
    optionals: { combinations: { labels: { pairs: { slots: string[][] } } } };
  };
  const pairs = source.optionals.combinations.labels.pairs;
  const markerRaid = loadRaid({
    ...source,
    botPatterns: undefined,
    events: source.events.filter(e => e.id.startsWith("mark-") || e.id === "elementary-deficiency"),
    optionals: { combinations: { labels: { pairs: { ...pairs, slots: pairs.slots.map(slot => slot.filter(id => id.startsWith("mark-"))) } } } },
  });
  // ot idles at spawn on the NE trapezoid, inside mark-ne.
  let world = runTicks(createWorld(markerRaid, 3), {}, Math.round(79.3 * 60));
  const stacks = () => byId(world, "ot").effects.find(e => e.name === "Elementary Deficiency")?.stacks;
  expect(stacks()).toBe(3);
  world = runTicks(world, {}, Math.round(0.2 * 60));
  expect(stacks()).toBe(3);
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
      expect(Math.hypot(shape.center.x, shape.center.z)).toBeCloseTo(15.753, 2);      // 1 inside the square center / inner edge midpoint
      if (shape.kind === "donut") expect([shape.inner, shape.outer]).toEqual([4.5, 14.85]);
      else expect(shape.radius).toBe(9.9);
      expect(orb.mover!.sprite).toBe(true);
    }
  }
});

test("each Cleansing orb destination has a blue floor pad while the orbs are up", () => {
  const events = preRollRaid(raid, 1).events;
  const pads = events.flatMap(e => e.type === "aoe" && e.id.startsWith("cleansing-pad-") ? [e] : []);
  const orbs = events.flatMap(e => e.type === "aoe" && e.id.startsWith("orb-") ? [e] : []);
  expect(pads).toHaveLength(3);
  for (const pad of pads) {
    const shape = toAOEShape(pad.shape);
    if (shape.kind !== "circle") throw new Error("pad shape");
    expect(shape.radius).toBe(1.35);
    expect(pad.damage).toBe(0);
    expect(pad.t + pad.telegraph).toBeCloseTo(32.7, 5);
    expect(orbs.some(o => { const s = toAOEShape(o.shape); return (s.kind === "circle" || s.kind === "donut") && s.center.x === shape.center.x && s.center.z === shape.center.z; })).toBe(true);
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

test("rings deal every player into groups of 3/2/3 with two of the three elements", () => {
  const sizes = [3, 2, 3];
  const applyAt = [27.32, 32.34, 46.37];
  for (let seed = 1; seed <= 40; seed++) {
    const events = preRollRaid(raid, seed).events;
    const dealt = new Map<string, { groups: Set<number>; elements: string[]; times: Set<number> }>();
    for (const event of events) {
      const match = /^ring([123])-(fire|blizzard|thunder)$/.exec(event.id);
      if (!match || event.type !== "apply_effect") continue;
      for (const id of event.players ?? []) {
        const entry = dealt.get(id) ?? { groups: new Set(), elements: [], times: new Set() };
        entry.groups.add(Number(match[1]) - 1);
        entry.elements.push(match[2]!);
        entry.times.add(event.t);
        dealt.set(id, entry);
      }
    }
    expect([...dealt.keys()].sort()).toEqual(raid.players.map(p => p.id).sort());
    const groupMembers: string[][] = [[], [], []];
    for (const [id, entry] of dealt) {
      expect(entry.groups.size).toBe(1);
      expect(new Set(entry.elements).size).toBe(2);
      expect(entry.elements).toHaveLength(2);
      const group = [...entry.groups][0]!;
      expect([...entry.times]).toEqual([applyAt[group]!]);
      groupMembers[group]!.push(id);
    }
    expect(groupMembers.map(members => members.length)).toEqual(sizes);
    for (const event of events) {
      const match = /^ring([123])-(n|s|ne|sw|se|nw)$/.exec(event.id);
      if (!match || event.type !== "aoe") continue;
      expect([...event.players!].sort()).toEqual(groupMembers[Number(match[1]) - 1]!.slice().sort());
      expect(event.t + event.telegraph).toBeCloseTo(applyAt[Number(match[1]) - 1]! + 6, 5);
    }
  }
});

test("a ring platform only hits its own group's carriers of its element", () => {
  // m1 and ot resolve on Fire at 33.32; h1 has the same rings but resolves later.
  const constraints = {
    "label-pairs-0": 2, "label-pairs-1": 0, "label-pairs-2": 1,
    "deal-rings-m1-group": 0, "deal-rings-m1-variant": 0,
    "deal-rings-ot-group": 0, "deal-rings-ot-variant": 0,
    "deal-rings-h1-group": 1, "deal-rings-h1-variant": 0,
  };
  expect(validateRngConstraints(raid, constraints)).toEqual(constraints);
  const world = createWorld({
    ...raid,
    events: raid.events.filter(event => event.id.startsWith("ring")),
    optionals: { towerRng: false, combinations: {
      labels: raid.optionals!.combinations!.labels,
      deals: raid.optionals!.combinations!.deals,
    } },
    players: roster({ m1: { spawn: [0, 20.5] }, ot: { spawn: [17.76, 10.25] }, h1: { spawn: [17.76, 10.25] } }),
  }, 3, constraints);
  const firstHit = runTicks(world, {}, 34 * 60);
  expect(byId(firstHit, "m1").hp).toBe(byId(firstHit, "m1").maxHp);
  expect(byId(firstHit, "ot").alive).toBe(false);
  expect(byId(firstHit, "h1").hp).toBe(byId(firstHit, "h1").maxHp);
  const secondHit = runTicks(firstHit, {}, 5 * 60);
  expect(byId(secondHit, "h1").alive).toBe(false);
});

test("ring deals reject more forced players than a group has seats", () => {
  const forced = Object.fromEntries(["mt", "ot", "h1", "h2"].map(id => [`deal-rings-${id}-group`, 1]));
  expect(validateRngConstraints(raid, forced)).toBeNull();
});

test("the ring pie holds for a second, then drains one slice a second to empty at the hit", () => {
  const effect = { appliedAt: 10, countdown: { delay: 1, slices: 5 } };
  expect(countdownSlicesLeft(effect, 10.5)).toBe(5);
  expect(countdownSlicesLeft(effect, 11.5)).toBe(5);
  expect(countdownSlicesLeft(effect, 12.5)).toBe(4);
  expect(countdownSlicesLeft(effect, 15.5)).toBe(1);
  expect(countdownSlicesLeft(effect, 16)).toBe(0);
});

test("the invisible opening cast keeps the boss stationary and facing north between attacks", () => {
  // Remove other facing locks and keep the tank alive to expose an early unlock.
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
  expect(lock.resolveAt).toBe(90);
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

function chemistryWorld(hits: [string, number][]) {
  const { optionals: _, sections: __, ...base } = rawRaid as Record<string, unknown>;
  return createWorld(loadRaid({
    ...base,
    events: [
      { id: "deficiency", type: "apply_effect", time: 1, name: "Elementary Deficiency", applyEffect: { ref: "elementary_deficiency" } },
      ...hits.map(([name, at], i) => ({ id: `hit-${i}`, type: "aoe", time: at - 1, name, telegraph: 1, damage: 10, damageType: "magical", shape: { kind: "circle", center: [0, 0], radius: 30 } })),
    ],
  }), 3);
}

const deficiencyOf = (world: ReturnType<typeof createWorld>) => byId(world, "m1").effects.find(e => e.name === "Elementary Deficiency");

test("Elementary Deficiency drops a stack per new element and clears after all three", () => {
  let world = chemistryWorld([["Fire IV", 3], ["Blizzard IV", 5], ["Thunder IV", 7]]);
  world = runTicks(world, {}, 2 * 60);
  expect(deficiencyOf(world)?.stacks).toBe(3);
  world = runTicks(world, {}, 2 * 60);
  expect(deficiencyOf(world)?.stacks).toBe(2);
  expect(byId(world, "m1").effects.some(e => e.name === "Fire Resistance Down II")).toBe(true);
  world = runTicks(world, {}, 2 * 60);
  expect(deficiencyOf(world)?.stacks).toBe(1);
  world = runTicks(world, {}, 2 * 60);
  expect(deficiencyOf(world)).toBeUndefined();
  world = runTicks(world, {}, 20 * 60);
  expect(world.players.every(p => p.alive)).toBe(true);
});

test("stacks left when Elementary Deficiency expires are lethal", () => {
  let world = chemistryWorld([["Fire IV", 3], ["Blizzard IV", 5]]);
  world = runTicks(world, {}, 22 * 60); // expires at 1 + 21.21
  expect(deficiencyOf(world)?.stacks).toBe(1);
  expect(byId(world, "m1").alive).toBe(true);
  world = runTicks(world, {}, 1 * 60);
  expect(byId(world, "m1").alive).toBe(false);
});

test("a repeat element drops no stack and is lethal under its Resistance Down", () => {
  let world = chemistryWorld([["Fire IV", 3], ["Fire IV", 5]]);
  world = runTicks(world, {}, 4 * 60);
  expect(deficiencyOf(world)?.stacks).toBe(2);
  world = runTicks(world, {}, 2 * 60);
  expect(world.players.every(p => !p.alive)).toBe(true);
});

test("Elementary Chemistry hits alternate trapezoid triples in each pad's pair element", () => {
  const hits = [66.96, 70, 73.03];
  const seen = new Set<string>();
  for (let seed = 1; seed <= 20; seed++) {
    const events = preRollRaid(raid, seed).events;
    const markName = new Map(events.filter(e => e.id.startsWith("mark-")).map(e => [e.id.slice(5), e.name]));
    const chem = events.flatMap(e => e.type === "aoe" && /^chem-[ab]\d-/.test(e.id) ? [e] : []);
    expect(chem).toHaveLength(9);
    const waves = hits.map(hit => chem.filter(e => Math.abs(e.t + e.telegraph - hit) < 1e-6).map(e => e.id.split("-")[2]!).sort());
    expect(waves.map(w => w.length)).toEqual([3, 3, 3]);
    expect(waves[2]).toEqual(waves[0]!);
    expect([...waves[0]!, ...waves[1]!].sort()).toEqual(["n", "ne", "nw", "s", "se", "sw"]);
    seen.add(waves[0]!.join(","));
    for (const e of chem) expect(e.name).toBe(markName.get(e.id.split("-")[2]!)!);
  }
  expect([...seen].sort()).toEqual(["n,se,sw", "ne,nw,s"]);
});

test("each avoidable hit adds a Thrice Come Ruin stack", () => {
  // mt stands still on the N trapezoid, so its pair's two round-1 waves both land on it.
  const world = runTicks(createWorld(raid, 3), {}, 26 * 60);
  const mt = byId(world, "mt");
  expect(mt.alive).toBe(true);
  expect(mt.effects.find(effect => effect.name === "Thrice Come Ruin")?.stacks).toBe(2);
});
