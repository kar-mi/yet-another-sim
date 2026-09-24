import { expect, test } from "bun:test";
import { RenderSnapshotBuffer } from "../renderSnapshotBuffer";
import { createWorld } from "../../engine/world";
import { createEmptyRaid } from "../../server/sessionRaid";

test("RenderSnapshotBuffer interpolates without mutating authoritative snapshots", () => {
  const buffer = new RenderSnapshotBuffer();
  const originalNow = performance.now;
  let now = 1000;
  performance.now = () => now;
  try {
    const worlds = Array.from({ length: 10 }, (_, tick) => {
      const world = createWorld(createEmptyRaid(), 1);
      world.time = tick / 60;
      world.players[0].pos.x = tick;
      return world;
    });
    buffer.start(worlds[0], 0);
    for (let tick = 1; tick < worlds.length; tick++) {
      now = 1000 + tick * (1000 / 60);
      buffer.push(worlds[tick], tick);
    }

    const view = buffer.getView(now);
    expect(view!.players[0].pos.x).toBeGreaterThan(0);
    expect(view!.players[0].pos.x).toBeLessThan(9);
    expect(worlds[9].players[0].pos.x).toBe(9);
  } finally {
    performance.now = originalNow;
  }
});

test("RenderSnapshotBuffer instances do not share interpolation output", () => {
  const a = new RenderSnapshotBuffer();
  const b = new RenderSnapshotBuffer();
  const worldA = createWorld(createEmptyRaid(), 1);
  const worldB = createWorld(createEmptyRaid(), 2);
  a.start(worldA, 0);
  b.start(worldB, 0);
  expect(a.getView(performance.now())).toBe(worldA);
  expect(b.getView(performance.now())).toBe(worldB);
});

function runDelivery(schedule: (tick: number) => number, ticks: number, frames: number) {
  const buffer = new RenderSnapshotBuffer();
  const originalNow = performance.now;
  let now = 0;
  performance.now = () => now;
  const worlds = Array.from({ length: ticks }, (_, tick) => {
    const world = createWorld(createEmptyRaid(), 1);
    world.time = tick / 60;
    return world;
  });
  const times: number[] = [];
  try {
    let next = 0;
    for (let frame = 0; frame < frames; frame++) {
      now = frame * FRAME_MS;
      while (next < ticks && schedule(next) <= now) {
        if (next === 0) buffer.start(worlds[0], 0);
        else buffer.push(worlds[next], next);
        next++;
      }
      times.push(buffer.getView(now)?.time ?? 0);
    }
  } finally {
    performance.now = originalNow;
  }
  return times;
}

const FRAME_MS = 1000 / 60;
const MAX_RATE_DEVIATION = 0.08;
const EPS = 1e-6;

test("RenderSnapshotBuffer plays steady delivery at real-time rate", () => {
  const times = runDelivery(tick => tick * FRAME_MS, 600, 600);
  for (let i = 240; i < times.length; i++) {
    expect(times[i] - times[i - 1]).toBeCloseTo(FRAME_MS / 1000, 4);
  }
});

test("RenderSnapshotBuffer keeps playback rate bounded through a stall and burst", () => {
  const STALL_TICK = 300;
  const STALL_MS = 250;
  const schedule = (tick: number) => tick < STALL_TICK ? tick * FRAME_MS : tick * FRAME_MS + STALL_MS - (tick < STALL_TICK + 15 ? (tick - STALL_TICK) * FRAME_MS : 15 * FRAME_MS);
  const times = runDelivery(schedule, 900, 900);
  const dt = FRAME_MS / 1000;
  const burstFrame = Math.ceil(schedule(STALL_TICK) / FRAME_MS);
  for (let i = 120; i < times.length; i++) {
    const advance = times[i] - times[i - 1];
    expect(advance).toBeGreaterThanOrEqual(-EPS);
    expect(advance).toBeLessThanOrEqual((1 + MAX_RATE_DEVIATION) * dt + EPS);
    if (i < STALL_TICK || i > burstFrame) expect(advance).toBeGreaterThanOrEqual((1 - MAX_RATE_DEVIATION) * dt - EPS);
  }
});

test("RenderSnapshotBuffer resets after a stall longer than a second", () => {
  const schedule = (tick: number) => tick < 300 ? tick * FRAME_MS : tick * FRAME_MS + 1500;
  const times = runDelivery(schedule, 810, 900);
  const lag = 809 / 60 - times[times.length - 1];
  expect(lag).toBeGreaterThan(0);
  expect(lag).toBeLessThan(0.25);
});
