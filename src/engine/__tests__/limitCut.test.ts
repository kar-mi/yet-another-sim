import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { baseRaid, loadRaid, noMove, roster, runTicks } from "./helpers";

function limitCutRaid(t = 0.05) {
  return loadRaid({
    ...baseRaid,
    duration: 10,
    players: roster(),
    events: [{
      type: "limit_cut",
      id: "lc",
      t,
      name: "Limit Cut",
      effect: {
        name: "Limit Cut",
        kind: "debuff",
        duration: 5,
        visibility: "invisible",
        behavior: { kind: "none" },
      },
    }],
  });
}

test("limit_cut assigns numbers 1–8 each exactly once", () => {
  const raid = limitCutRaid(0.05);
  // Tick past t=0.05 so the event fires.
  const w = runTicks(createWorld(raid, 1), noMove, 10);
  const markers = w.players
    .flatMap(p => p.effects.filter(e => e.name === "Limit Cut" && e.marker !== undefined))
    .map(e => e.marker!);
  expect(markers.sort()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
});

test("limit_cut drains pendingLimitCuts after t fires", () => {
  const raid = limitCutRaid(0.05);
  const w = runTicks(createWorld(raid, 1), noMove, 10);
  expect(w.pendingLimitCuts.length).toBe(0);
});

test("limit_cut assignment is deterministic for a fixed seed", () => {
  const raid = limitCutRaid(0.05);
  const w1 = runTicks(createWorld(raid, 42), noMove, 10);
  const w2 = runTicks(createWorld(raid, 42), noMove, 10);
  const markers1 = w1.players.map(p => p.effects.find(e => e.name === "Limit Cut")?.marker ?? null);
  const markers2 = w2.players.map(p => p.effects.find(e => e.name === "Limit Cut")?.marker ?? null);
  expect(markers1).toEqual(markers2);
});

test("limit_cut assignment differs across seeds (probabilistically)", () => {
  const raid = limitCutRaid(0.05);
  const order = (seed: number) =>
    runTicks(createWorld(raid, seed), noMove, 10)
      .players.map(p => p.effects.find(e => e.name === "Limit Cut")?.marker ?? null);
  // With 8! = 40320 orderings, two random seeds producing the same order is ~1/40320.
  // Test with several seeds to be confident; allow 1 match but not all.
  const results = [1, 2, 3, 4, 5].map(order);
  const allSame = results.every(r => JSON.stringify(r) === JSON.stringify(results[0]));
  expect(allSame).toBe(false);
});

test("limit_cut not yet fired stays pending", () => {
  const raid = limitCutRaid(100); // t=100, way in the future
  const w = runTicks(createWorld(raid, 1), noMove, 10);
  expect(w.pendingLimitCuts.length).toBe(1);
  // No limit cut markers on any player
  const markers = w.players.flatMap(p => p.effects.filter(e => e.name === "Limit Cut"));
  expect(markers.length).toBe(0);
});
