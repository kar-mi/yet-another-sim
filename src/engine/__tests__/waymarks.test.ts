import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { baseRaid, loadRaid, roster } from "./helpers";

test("loadRaid rejects rosters that do not match the canonical order", () => {
  expect(() => loadRaid({ ...baseRaid, players: [{ id: "p1", role: "dps", spawn: [0, 0] }] })).toThrow();
  expect(() => loadRaid({ ...baseRaid, players: roster().slice(0, 7) })).toThrow();
  expect(() => loadRaid({ ...baseRaid, players: [...roster()].reverse() })).toThrow();
});

test("waymarks round-trip into the world", () => {
  const raid = loadRaid({
    ...baseRaid,
    waymarks: [{ mark: "A", pos: [1, 2] }, { mark: "3", pos: [-4, 5] }],
  });
  const world = createWorld(raid);
  expect(world.waymarks).toEqual([
    { mark: "A", pos: { x: 1, z: 2 } },
    { mark: "3", pos: { x: -4, z: 5 } },
  ]);
});

test("waymarks default to empty when omitted", () => {
  expect(createWorld(loadRaid(baseRaid)).waymarks).toEqual([]);
});

test("loadRaid rejects duplicate waymarks", () => {
  expect(() => loadRaid({ ...baseRaid, waymarks: [{ mark: "A", pos: [0, 0] }, { mark: "A", pos: [1, 1] }] })).toThrow();
});

