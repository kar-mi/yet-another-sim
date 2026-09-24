import { describe, expect, test } from "bun:test";
import type { Frame, ServerMessage } from "@model/protocol";
import type { World } from "@model/types";
import { ReplayTransport } from "../replayTransport";

function makeFrames(count: number): Frame[] {
  return Array.from({ length: count }, () => ({ intents: {} as Frame["intents"], botsInvincible: false }));
}

describe("ReplayTransport self-correcting deliver", () => {
  test("catches up to wall-clock elapsed ticks in one fire, not one frame per fire", () => {
    const frames = makeFrames(120);
    const transport = new ReplayTransport({ raidId: "", world: {} as World, frames });
    const messages: Extract<ServerMessage, { type: "frames" }>[] = [];
    transport.onMessage(message => {
      if (message.type === "frames") messages.push(message);
    });

    let now = 1000;
    const originalNow = performance.now;
    performance.now = () => now;
    try {
      transport.play();
      now += 505;
      (transport as unknown as { deliver: () => void }).deliver();

      expect(messages.length).toBe(1);
      expect(messages[0]!.frames.length).toBe(30);
      expect(transport.currentTick()).toBe(30);
    } finally {
      performance.now = originalNow;
    }
  });

  test("clamps a very large catch-up to the max batch size across fires", () => {
    const frames = makeFrames(2000);
    const transport = new ReplayTransport({ raidId: "", world: {} as World, frames });
    const messages: Extract<ServerMessage, { type: "frames" }>[] = [];
    transport.onMessage(message => {
      if (message.type === "frames") messages.push(message);
    });

    let now = 1000;
    const originalNow = performance.now;
    performance.now = () => now;
    try {
      transport.play();
      now += 10_005;
      const deliver = () => (transport as unknown as { deliver: () => void }).deliver();
      deliver();

      expect(messages[0]!.frames.length).toBeLessThanOrEqual(240);
      const firstBatch = messages[0]!.frames.length;

      deliver();
      expect(messages.length).toBe(1);

      now += 505;
      deliver();
      expect(messages.length).toBe(2);
      expect(transport.currentTick()).toBe(firstBatch + messages[1]!.frames.length);
    } finally {
      performance.now = originalNow;
    }
  });
});

describe("ReplayTransport sync", () => {
  test("seeks only when the tick changes, clamps to the duration, and follows play/pause", () => {
    const transport = new ReplayTransport({ raidId: "", world: {} as World, frames: makeFrames(100) });
    const started: number[] = [];
    transport.onMessage(message => {
      if (message.type === "started") started.push(message.tick);
    });

    transport.sync({ playing: false, tick: 40 });
    expect(started).toEqual([40]);
    expect(transport.isPlaying()).toBe(false);

    transport.sync({ playing: false, tick: 40 });
    expect(started).toEqual([40]);

    transport.sync({ playing: true, tick: 40 });
    expect(transport.isPlaying()).toBe(true);
    transport.sync({ playing: false, tick: 40 });
    expect(transport.isPlaying()).toBe(false);

    transport.sync({ playing: false, tick: 500 });
    expect(started).toEqual([40, 100]);
    expect(transport.currentTick()).toBe(100);
    transport.close();
  });
});
