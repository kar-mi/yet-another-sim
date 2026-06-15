import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { DPS_HP } from "./constants";
import { baseRaid, loadRaid, roster, runTicks } from "./helpers";
import type { Vec } from "./helpers";

const gazeEvent = (over: Record<string, unknown> = {}) => ({
  type: "gaze" as const,
  t: 0.1,
  name: "Gaze",
  telegraph: 0.1,
  damage: 40,
  damageType: "magical" as const,
  pos: [0, 10] as Vec, // eye to the north (+Z); a player facing +Z is looking at it
  ...over,
});

test("gaze: a normal eye hits players facing it and spares those facing away", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] }, m2: { spawn: [0, 20] } }),
    events: [gazeEvent()],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(0.3 * 60));
  expect(world.players.find(p => p.id === "m1")!.hp).toBe(60);  // eye is in front (+Z): hit
  expect(world.players.find(p => p.id === "m2")!.hp).toBe(DPS_HP); // eye is behind: safe
});

test("gaze: a reverse '?' eye hits players facing away and spares those facing it", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] }, m2: { spawn: [0, 20] } }),
    events: [gazeEvent({ reverse: true })],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(0.3 * 60));
  expect(world.players.find(p => p.id === "m1")!.hp).toBe(DPS_HP); // looking at it: safe
  expect(world.players.find(p => p.id === "m2")!.hp).toBe(60);  // facing away: hit
});

test("gaze: a narrow coneHalfAngle spares players off to the side", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] }, m2: { spawn: [10, 10] } }),
    events: [gazeEvent({ coneHalfAngle: Math.PI / 4 })],
  });
  const world = runTicks(createWorld(raid), {}, Math.ceil(0.3 * 60));
  expect(world.players.find(p => p.id === "m1")!.hp).toBe(60);  // eye straight ahead: hit
  expect(world.players.find(p => p.id === "m2")!.hp).toBe(DPS_HP); // eye 90 off-axis, outside cone: safe
});

test("gaze rng eventually picks both normal and reverse", () => {
  const raid = {
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] } }),
    events: [gazeEvent({ t: 0, telegraph: 1, rng: true })],
  };
  const seen = new Set<boolean>();
  for (let i = 0; i < 40; i++) {
    const w = tick(createWorld(loadRaid(raid)), {}, 1 / 60); // promote on first tick
    seen.add(w.gazes[0].reverse);
  }
  expect(seen).toEqual(new Set([true, false]));
});

