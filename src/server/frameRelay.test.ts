import { expect, test } from "bun:test";
import type { Frame } from "@shared/protocol";
import { FrameRelay, frameRelaySchedulerSnapshot } from "./frameRelay";

function makeRelay(options: { autoTick?: boolean; now?: () => number; isRunning?: () => boolean } = {}) {
  const frames: Array<{ startTick: number; frames: Frame[] }> = [];
  const relay = new FrameRelay({
    now: options.now ?? (() => 0),
    autoTick: options.autoTick ?? true,
    sessionLog: () => null,
    buildFrame: () => ({ intents: {}, botsInvincible: false }),
    onFrames: (startTick, batch) => frames.push({ startTick, frames: batch }),
    onCeiling: () => {},
    isRunning: options.isRunning ?? (() => true),
  });
  relay.reset(30);
  return { relay, frames };
}

test("autoTick false does not register with the shared scheduler", () => {
  const { relay, frames } = makeRelay({ autoTick: false });

  relay.start();
  expect(frameRelaySchedulerSnapshot()).toEqual({ activeRelays: 0, running: false });

  relay.produceFrame();
  relay.flush();

  expect(frames).toHaveLength(1);
  expect(frames[0].startTick).toBe(0);
});

test("autoTick relays register and unregister with one shared scheduler", () => {
  const a = makeRelay();
  const b = makeRelay();

  try {
    a.relay.start();
    expect(frameRelaySchedulerSnapshot()).toEqual({ activeRelays: 1, running: true });

    b.relay.start();
    expect(frameRelaySchedulerSnapshot()).toEqual({ activeRelays: 2, running: true });

    a.relay.stop();
    expect(frameRelaySchedulerSnapshot()).toEqual({ activeRelays: 1, running: true });

    b.relay.stop();
    expect(frameRelaySchedulerSnapshot()).toEqual({ activeRelays: 0, running: false });
  } finally {
    a.relay.stop();
    b.relay.stop();
  }
});

test("starting an already registered relay does not duplicate it", () => {
  const { relay } = makeRelay();

  try {
    relay.start();
    relay.start();

    expect(frameRelaySchedulerSnapshot()).toEqual({ activeRelays: 1, running: true });
  } finally {
    relay.stop();
  }
});

test("shared scheduler drives due frames", () => {
  let now = 0;
  const { relay, frames } = makeRelay({ now: () => now });

  relay.start();
  try {
    now = 20;
    relay.runDueTicks();
  } finally {
    relay.stop();
  }

  expect(relay.tick).toBe(1);
  expect(frames).toHaveLength(1);
  expect(frames[0].startTick).toBe(0);
});
