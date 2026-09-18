import { expect, test } from "bun:test";
import { preRollRaid } from "../preRoll";
import { baseRaid, loadRaid, roster } from "./helpers";

const WAVE = {
  type: "aoe", name: "Wave", telegraph: 1, damage: 1, damageType: "magical",
  shape: { kind: "circle", center: [0, 0], radius: 1 },
};

function raid(extra: Record<string, unknown> = {}) {
  return loadRaid({
    ...baseRaid,
    players: roster(),
    optionals: {
      timeShuffle: [
        { id: "first", rng: true, groups: [["a1"], ["b1"], ["c1"]] },
        { id: "second", rng: true, noRepeatAfter: "first", groups: [["a2"], ["b2"], ["c2"]] },
      ],
      ...extra,
    },
    events: [
      { ...WAVE, id: "a1", time: 1 }, { ...WAVE, id: "b1", time: 2 }, { ...WAVE, id: "c1", time: 3 },
      { ...WAVE, id: "a2", time: 4 }, { ...WAVE, id: "b2", time: 5 }, { ...WAVE, id: "c2", time: 6 },
    ],
  });
}

type TimedEvent = { id: string; t: number; telegraph: number };
const timed = (events: ReturnType<typeof preRollRaid>["events"]): TimedEvent[] =>
  events.filter((e): e is typeof e & TimedEvent => "t" in e && "telegraph" in e);

function order(seed: number) {
  return timed(preRollRaid(raid(), seed).events).sort((x, y) => x.t - y.t).map(e => e.id[0]!).join("");
}

test("timeShuffle permutes the authored times within each entry", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    const rolled = order(seed);
    seen.add(rolled);
    expect(new Set(rolled.slice(0, 3)).size).toBe(3);
    expect(new Set(rolled.slice(3)).size).toBe(3);
  }
  expect(seen.size).toBeGreaterThan(1);
});

test("noRepeatAfter keeps the same group from taking both sides of the join", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rolled = order(seed);
    expect(rolled[2]).not.toBe(rolled[3]);
  }
});

test("pinned decisions reproduce the same order", () => {
  const { decisions } = preRollRaid(raid(), 11);
  expect(timed(preRollRaid(raid(), 99, decisions).events).map(e => e.t))
    .toEqual(timed(preRollRaid(raid(), 11).events).map(e => e.t));
});

test("a group without rng keeps its authored times", () => {
  const fixed = loadRaid({
    ...baseRaid,
    players: roster(),
    optionals: { timeShuffle: [{ id: "still", groups: [["a1"], ["b1"]] }] },
    events: [{ ...WAVE, id: "a1", time: 1 }, { ...WAVE, id: "b1", time: 2 }],
  });
  expect(timed(preRollRaid(fixed, 5).events).map(e => [e.id, e.t])).toEqual([["a1", 1], ["b1", 2]]);
});

test("timeShuffle rejects ambiguous entry ids and incompatible no-repeat groups", () => {
  expect(() => raid({ timeShuffle: [
    { id: "same", groups: [["a1"], ["b1"], ["c1"]] },
    { id: "same", groups: [["a2"], ["b2"], ["c2"]] },
  ] })).toThrow("duplicate timeShuffle id");
  expect(() => raid({ timeShuffle: [
    { id: "first", groups: [["a1"], ["b1"], ["c1"]] },
    { id: "second", noRepeatAfter: "first", groups: [["a2"], ["b2"]] },
  ] })).toThrow("same number of groups");
});
