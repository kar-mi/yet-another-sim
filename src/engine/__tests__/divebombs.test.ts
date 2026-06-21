import { expect, test } from "bun:test";
import { DIVEBOMB_LINGER } from "@shared/constants";
import { divebombPosition } from "@shared/divebomb";
import { tick } from "../sim";
import { createWorld } from "../world";
import { baseRaid, loadRaid, roster } from "./helpers";
import type { Vec } from "./helpers";

const divebombEvent = (over: Record<string, unknown> = {}) => ({
  type: "divebomb" as const,
  t: 0,
  name: "Divebomb",
  from: [0, 0] as Vec,
  to: [0, 10] as Vec,
  speed: 20,
  size: 2,
  duration: 1,
  damage: 10,
  ...over,
});

const raidWith = (event: Record<string, unknown>) => loadRaid({
  ...baseRaid,
  players: roster({ m1: { spawn: [0, 0] }, m2: { spawn: [5, 0] } }),
  events: [event],
});

test("divebomb damages players in its active circle and respects hit interval", () => {
  const world0 = createWorld(raidWith(divebombEvent({ hitInterval: 0.5 })));
  const world1 = tick(world0, {}, 0.1);
  expect(world1.players.find(p => p.id === "m1")!.hp).toBe(90);
  expect(world1.players.find(p => p.id === "m2")!.hp).toBe(100);
  expect(world1.log.filter(entry => entry.mechanic === "Divebomb" && entry.playerId === "m1")).toHaveLength(1);

  const world2 = tick(world1, {}, 0.1);
  expect(world2.players.find(p => p.id === "m1")!.hp).toBe(90);
  expect(world2.log.filter(entry => entry.mechanic === "Divebomb" && entry.playerId === "m1")).toHaveLength(1);
});

test("visual-only divebombs do not change HP, hit state, or logs", () => {
  const world = tick(createWorld(raidWith(divebombEvent({ damage: undefined }))), {}, 0.1);
  expect(world.players.find(p => p.id === "m1")!.hp).toBe(100);
  expect(world.log).toHaveLength(0);
  expect(world.divebombs[0]!.hits).toEqual({});
});

test("effect-only divebombs apply and log an effect", () => {
  const world = tick(createWorld(raidWith(divebombEvent({
    damage: undefined,
    applyEffect: { name: "Marked", kind: "debuff", duration: 2, behavior: { kind: "none" } },
  }))), {}, 0.1);
  const player = world.players.find(p => p.id === "m1")!;
  expect(player.hp).toBe(100);
  expect(player.effects.some(effect => effect.name === "Marked")).toBe(true);
  expect(world.log.filter(entry => entry.mechanic === "Divebomb" && entry.playerId === "m1")).toHaveLength(1);
});

test("divebomb hit maps do not mutate previous world snapshots", () => {
  const world1 = tick(createWorld(raidWith(divebombEvent({ damage: 1, gap: 100, hitInterval: 0.1 }))), {}, 0.1);
  const originalHits = { ...world1.divebombs[0]!.hits };
  const world2 = tick(world1, {}, 0.1);
  expect(world1.divebombs[0]!.hits).toEqual(originalHits);
  expect(world2.divebombs[0]!.hits.m1).toBe(0.2);
});

test("divebomb rejects equal endpoints", () => {
  expect(() => raidWith(divebombEvent({ from: [1, 1], to: [1, 1] }))).toThrow("divebomb endpoints must be distinct");
});

test("resolved divebombs remain for their render linger and are then culled", () => {
  const world0 = createWorld(raidWith(divebombEvent({ duration: 0.2, damage: undefined })));
  const world1 = tick(world0, {}, 0.2);
  expect(world1.divebombs[0]!.resolved).toBe(true);
  const world2 = tick(world1, {}, DIVEBOMB_LINGER - 0.01);
  expect(world2.divebombs).toHaveLength(1);
  const world3 = tick(world2, {}, 0.02);
  expect(world3.divebombs).toHaveLength(0);
});

test("divebomb advances one discrete circle at a time and includes the endpoint", () => {
  expect(divebombPosition({ x: 0, z: 0 }, { x: 0, z: 10 }, 4, 4, 0)).toEqual({ x: 0, z: 0 });
  expect(divebombPosition({ x: 0, z: 0 }, { x: 0, z: 10 }, 4, 4, 1)).toEqual({ x: 0, z: 4 });
  expect(divebombPosition({ x: 0, z: 0 }, { x: 0, z: 10 }, 4, 4, 3)).toEqual({ x: 0, z: 10 });
  expect(divebombPosition({ x: 0, z: 0 }, { x: 0, z: 10 }, 4, 4, 4)).toEqual({ x: 0, z: 0 });
});
