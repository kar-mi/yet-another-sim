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
