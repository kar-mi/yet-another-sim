import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { baseRaid, loadRaid } from "./helpers";

const spots = [[-14, 14], [14, 14], [14, -14], [-14, -14]] as const;

test("crystals default to empty when omitted", () => {
  expect(createWorld(loadRaid(baseRaid)).crystals).toEqual([]);
});

test("crystals block parses independent single entries", () => {
  const world = createWorld(loadRaid({
    ...baseRaid,
    crystals: [
      { kind: "single", element: "wind", pos: spots[0], spawnAt: 24 },
      { kind: "single", element: "fire", pos: spots[1], spawnAt: 24 },
      { kind: "single", element: "water", pos: spots[2], spawnAt: 24 },
      { element: "earth", pos: spots[3], spawnAt: 24 },
    ],
  }));

  expect(world.crystals).toEqual([
    { id: "crystal-wind", element: "wind", pos: { x: -14, z: 14 }, spawnAt: 24 },
    { id: "crystal-fire", element: "fire", pos: { x: 14, z: 14 }, spawnAt: 24 },
    { id: "crystal-water", element: "water", pos: { x: 14, z: -14 }, spawnAt: 24 },
    { id: "crystal-earth", element: "earth", pos: { x: -14, z: -14 }, spawnAt: 24 },
  ]);
});

test("crystals schema enforces four candidate spots", () => {
  expect(() => loadRaid({
    ...baseRaid,
    crystals: [{ kind: "rotatingTrio", spots: [[-14, 14], [14, 14], [14, -14]] }],
  })).toThrow();
});

test("rng crystal placement is deterministic and wind is opposite the empty slot", () => {
  const raid = loadRaid({
    ...baseRaid,
    crystals: [{ kind: "rotatingTrio", spots }],
  });
  const a = createWorld(raid, 12345);
  const b = createWorld(raid, 12345);

  expect(a.crystals).toEqual(b.crystals);

  const occupied = new Set(a.crystals.map(c => `${c.pos.x},${c.pos.z}`));
  const emptyIndex = spots.findIndex(([x, z]) => !occupied.has(`${x},${z}`));
  const wind = a.crystals.find(c => c.element === "wind")!;
  const windIndex = spots.findIndex(([x, z]) => wind.pos.x === x && wind.pos.z === z);

  expect(a.crystals).toHaveLength(3);
  expect(emptyIndex).toBeGreaterThanOrEqual(0);
  expect(windIndex).toBe((emptyIndex + 2) % 4);
  expect(new Set(a.crystals.map(c => c.element))).toEqual(new Set(["wind", "fire", "water"]));
});
