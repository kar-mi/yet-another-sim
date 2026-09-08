import { expect, test } from "bun:test";
import type { Frame } from "@shared/protocol";
import type { World } from "@shared/types";
import { REPLAY_FORMAT_VERSION, type ReplayData } from "@shared/replay";
import { createWorld } from "../../engine/world";
import { loadRaid } from "../../engine/raidLoader";
import { CLOCK_SPOTS, ROSTER } from "@shared/protocol";
import { collectReplayInsights } from "../replayInsights";
import { SimulationReplica } from "../simulationReplica";

const IDLE: Frame = { intents: {} as Frame["intents"], botsInvincible: false };
const frames = (count: number): Frame[] => Array.from({ length: count }, () => IDLE);

// Whole party stacked on the origin so a centered AOE is guaranteed to connect.
function stackedRaid(events: unknown[], sections?: unknown[]) {
  return loadRaid({
    name: "Insights",
    arena: { zones: [{ kind: "circle", center: [0, 0], radius: 20 }] },
    duration: 30,
    players: ROSTER.map(({ id, role }) => ({ id, role, spawn: [0, 0] as [number, number] })),
    events,
    ...(sections ? { sections } : {}),
  });
}

function aoe(id: string, t: number, extra: Record<string, unknown> = {}): unknown {
  return {
    type: "aoe", id, t, name: `Cast ${id}`, telegraph: 0.5, damage: 10, damageType: "true",
    shape: { kind: "circle", center: [0, 0], radius: 5 }, ...extra,
  };
}

function replay(world: World, tickCount: number, formatVersion = REPLAY_FORMAT_VERSION): ReplayData {
  return { formatVersion, raidId: "debug/insights", world, frames: frames(tickCount) };
}

// Reference implementation of the transport's seek convention: seeking to tick N applies N frames.
function worldAtTick(data: ReplayData, tick: number): World {
  const replica = new SimulationReplica();
  return replica.adopt(data.world, 0, data.frames.slice(0, tick));
}

test("collects one hit per player for a tagged source, with party slot labels", () => {
  const data = replay(createWorld(stackedRaid([aoe("boom", 0, { avoidable: true })])), 120);
  const insights = collectReplayInsights(data);

  expect(insights.available).toBe(true);
  expect(insights.players.map(p => p.id)).toEqual(ROSTER.map(r => r.id));
  const hits = insights.events.filter(event => event.kind === "hit");
  expect(hits).toHaveLength(8);
  expect(hits.every(event => event.sourceId === "boom" && event.sourceName === "Cast boom")).toBe(true);
  expect(hits.every(event => event.hpLoss === 10)).toBe(true);
  expect(new Set(hits.map(event => event.playerLabel))).toEqual(new Set(ROSTER.map(r => r.id)));
});

test("event ticks follow the transport seek convention: the state at that tick is post-resolve", () => {
  const data = replay(createWorld(stackedRaid([aoe("boom", 0, { avoidable: true })])), 120);
  const event = collectReplayInsights(data).events[0]!;

  expect(worldAtTick(data, event.tick).players.every(p => p.hp < p.maxHp)).toBe(true);
  expect(worldAtTick(data, event.tick - 1).players.every(p => p.hp === p.maxHp)).toBe(true);
});

test("a lethal avoidable hit yields a hit and a death linked to it", () => {
  const data = replay(createWorld(stackedRaid([aoe("boom", 0, { damage: 500, avoidable: true })])), 120);
  const insights = collectReplayInsights(data);

  const deaths = insights.events.filter(event => event.kind === "death");
  const hits = insights.events.filter(event => event.kind === "hit");
  expect(deaths).toHaveLength(8);
  expect(hits).toHaveLength(8);
  for (const death of deaths) {
    const linked = hits.find(hit => hit.id === death.hitEventId);
    expect(linked).toBeDefined();
    expect(linked!.playerId).toBe(death.playerId);
    expect(linked!.sourceId).toBe(death.sourceId);
  }
});

test("an unavoidable death has no linked hit", () => {
  const data = replay(createWorld(stackedRaid([aoe("boom", 0, { damage: 500 })])), 120);
  const insights = collectReplayInsights(data);

  expect(insights.events.every(event => event.kind === "death")).toBe(true);
  expect(insights.events.every(event => event.hitEventId === undefined)).toBe(true);
});

test("events carry the authored section they fall inside", () => {
  const data = replay(createWorld(stackedRaid(
    [aoe("early", 0, { avoidable: true }), aoe("late", 3, { avoidable: true })],
    [{ id: "opener", name: "Opener", t: 0 }, { id: "adds", name: "Adds", t: 2 }],
  )), 400);
  const insights = collectReplayInsights(data);

  expect(insights.sections.map(section => section.id)).toEqual(["opener", "adds"]);
  expect(insights.events.find(event => event.sourceId === "early")!.sectionId).toBe("opener");
  expect(insights.events.find(event => event.sourceId === "late")!.sectionId).toBe("adds");
});

test("collecting twice produces identical events — no duplicates from re-collection", () => {
  const data = replay(createWorld(stackedRaid([aoe("boom", 0, { avoidable: true })])), 120);
  expect(collectReplayInsights(data)).toEqual(collectReplayInsights(data));
});

test("event ids are unique across a pull", () => {
  const data = replay(createWorld(stackedRaid([
    aoe("first", 0, { avoidable: true }),
    aoe("second", 2, { avoidable: true }),
  ])), 300);
  const ids = collectReplayInsights(data).events.map(event => event.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("a pre-format-2 recording reports no review data at all", () => {
  const data = replay(createWorld(stackedRaid([aoe("boom", 0, { avoidable: true })])), 120, 1);
  const insights = collectReplayInsights(data);

  expect(insights.available).toBe(false);
  expect(insights.events).toEqual([]);
  expect(insights.sections).toEqual([]);
});

test("a format-2 recording with nothing to report is available but empty", () => {
  const data = replay(createWorld(stackedRaid([aoe("boom", 0)])), 120);
  const insights = collectReplayInsights(data);

  expect(insights.available).toBe(true);
  expect(insights.events).toEqual([]);
});

test("clock-spot spawns keep a centered AOE a miss, recording nothing", () => {
  const raid = loadRaid({
    name: "Insights",
    arena: { zones: [{ kind: "circle", center: [0, 0], radius: 20 }] },
    duration: 30,
    players: ROSTER.map(({ id, role }) => ({ id, role, spawn: CLOCK_SPOTS[id] })),
    events: [aoe("boom", 0, { avoidable: true })],
  });
  expect(collectReplayInsights(replay(createWorld(raid), 120)).events).toEqual([]);
});
