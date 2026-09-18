import { expect, test } from "bun:test";
import { preRollRaid } from "../preRoll";
import { baseRaid, loadRaid, roster } from "./helpers";

const AOE = {
  type: "aoe", name: "Unnamed", telegraph: 1, damage: 1, damageType: "magical",
  shape: { kind: "circle", center: [0, 0], radius: 1 },
};

const raid = loadRaid({
  ...baseRaid,
  players: roster(),
  optionals: {
    combinations: {
      labels: {
        pairs: {
          rng: true,
          slots: [["a1", "a2"], ["b1"], ["c1"]],
          variants: [
            { name: "Fire", color: "#ff0000" },
            { name: "Ice", color: "#0000ff" },
            { name: "Thunder", color: "#800080" },
          ],
        },
      },
    },
  },
  events: [
    { ...AOE, id: "a1", time: 1 }, { ...AOE, id: "a2", time: 2 },
    { ...AOE, id: "b1", time: 3 }, { ...AOE, id: "c1", time: 4 },
    { ...AOE, id: "unlabelled", time: 5 },
  ],
});

function named(seed: number) {
  return Object.fromEntries(preRollRaid(raid, seed).events.map(e => [e.id, e.name]));
}

test("each variant lands on exactly one slot, and every event in a slot shares it", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 30; seed++) {
    const names = named(seed);
    expect(names.a1).toBe(names.a2!);
    expect(new Set([names.a1, names.b1, names.c1]).size).toBe(3);
    expect(names.unlabelled).toBe("Unnamed");
    seen.add(`${names.a1}${names.b1}${names.c1}`);
  }
  expect(seen.size).toBeGreaterThan(1);
});

test("the colour travels with the name", () => {
  const events = preRollRaid(raid, 4).events;
  const byName: Record<string, string> = { Fire: "#ff0000", Ice: "#0000ff", Thunder: "#800080" };
  for (const event of events) {
    if (event.id === "unlabelled" || !("color" in event)) continue;
    expect(event.color).toBe(byName[event.name]!);
  }
});

test("label slots reject missing events and overlapping assignments", () => {
  const spec = raid.optionals!.combinations!.labels!.pairs!;
  for (const slots of [[["missing"], ["b1"], ["c1"]], [["a1"], ["a1"], ["c1"]]]) {
    expect(() => loadRaid({
      ...baseRaid,
      optionals: { combinations: { labels: { pairs: { ...spec, slots } } } },
      events: ["a1", "b1", "c1"].map(id => ({ ...AOE, id, time: 1 })),
    })).toThrow();
  }
});
