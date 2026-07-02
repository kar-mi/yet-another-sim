import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { baseRaid, loadRaid, roster } from "./helpers";

function idsForSeed(seed: number) {
  const raid = loadRaid({
    ...baseRaid,
    players: roster(),
    optionals: {
      combinations: {
        eventSets: {
          branch: {
            rng: true,
            sets: [["left"], ["right-1", "right-2"]],
          },
        },
      },
    },
    events: [
      { type: "heal", id: "left", time: 1, name: "Left" },
      { type: "heal", id: "right-1", time: 1, name: "Right 1" },
      { type: "heal", id: "right-2", time: 1, name: "Right 2" },
      { type: "heal", id: "always", time: 1, name: "Always" },
    ],
  });

  return createWorld(raid, seed).pendingHeals.map(event => event.id).sort();
}

test("eventSets keeps one selected event set and drops the other sets", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 20; seed++) seen.add(idsForSeed(seed).join(","));

  expect(seen).toContain("always,left");
  expect(seen).toContain("always,right-1,right-2");
  expect(idsForSeed(7)).toEqual(idsForSeed(7));
});
