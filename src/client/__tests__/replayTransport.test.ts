import { describe, expect, test } from "bun:test";
import type { Frame, ServerMessage } from "@shared/protocol";
import type { World } from "@shared/types";
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
      // Simulate ~505ms elapsed (~30.3 ticks at 60Hz) but only one timer fire.
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
      // Simulate a huge stall (e.g. backgrounded tab): ~10s elapsed = ~600 ticks.
      now += 10_005;
      const deliver = () => (transport as unknown as { deliver: () => void }).deliver();
      deliver();

      expect(messages[0]!.frames.length).toBeLessThanOrEqual(240);
      const firstBatch = messages[0]!.frames.length;

      // Next timer fire, still within the same stalled instant: the clamp re-anchors
      // to "now", so no further ticks have elapsed yet and nothing new is delivered.
      deliver();
      expect(messages.length).toBe(1);

      // A subsequent real fire after the re-anchor delivers the remaining catch-up.
      now += 505;
      deliver();
      expect(messages.length).toBe(2);
      expect(transport.currentTick()).toBe(firstBatch + messages[1]!.frames.length);
    } finally {
      performance.now = originalNow;
    }
  });
});
