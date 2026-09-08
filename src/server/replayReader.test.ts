import { afterEach, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "path";
import { worldHash } from "@shared/worldHash";
import { tick } from "../engine/sim";
import { computeBotIntents } from "../engine/botIntent";
import { createWorld } from "../engine/world";
import { createEmptyRaid } from "./sessionRaid";
import { createSessionLog } from "./logger";
import { listReplays, loadReplay } from "./replayReader";
import type { Frame } from "@shared/protocol";
import type { World } from "@shared/types";
import { REPLAY_FORMAT_VERSION } from "@shared/replay";

const SESSION_LOG_DIR = join(import.meta.dir, "..", "..", "logs", "sessions");
const SESSION = "replay-reader-test";
const DT = 1 / 60;

const written: string[] = [];

function pullPath(pull: number): string {
  const path = join(SESSION_LOG_DIR, `${SESSION}-pull-${pull}.jsonl`);
  written.push(path);
  return path;
}

function headerLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    header: true,
    formatVersion: REPLAY_FORMAT_VERSION,
    raidId: "debug/test",
    world: createWorld(createEmptyRaid(), 123),
    ...overrides,
  });
}

async function writePull(pull: number, body: string): Promise<void> {
  await Bun.write(pullPath(pull), body);
}

afterEach(() => {
  for (const path of written) if (existsSync(path)) rmSync(path);
  written.length = 0;
});

function replay(world: World, frames: Frame[]): World {
  let current = structuredClone(world);
  for (const frame of frames) {
    current = tick(current, { ...computeBotIntents(current, DT), ...frame.intents }, DT);
    current.log.length = 0;
  }
  return current;
}

test("reads saved pull summaries and frame logs", async () => {
  const frames: Frame[] = [
    { intents: {}, botsInvincible: false },
    { intents: {}, botsInvincible: false },
  ];
  const world = createWorld(createEmptyRaid(), 123);
  const log = createSessionLog(`${SESSION}-pull-2`);
  pullPath(2);
  log.header("debug/test", world);
  log.frame(0, frames);
  log.close();

  expect(await listReplays(SESSION)).toEqual([{
    pull: 2, raidId: "debug/test", ticks: 2, supported: true, formatVersion: REPLAY_FORMAT_VERSION,
  }]);

  const loaded = await loadReplay(SESSION, 2);
  expect(loaded?.raidId).toBe("debug/test");
  expect(loaded?.frames).toEqual(frames);
  // The replayed world must match the original world stepped through the same
  // frames, not merely a second replay of itself.
  expect(worldHash(replay(loaded!.world, loaded!.frames))).toBe(worldHash(replay(world, frames)));
});

test("lists unversioned pull logs as unsupported and rejects loading them", async () => {
  await writePull(3, [
    JSON.stringify({ header: true, raidId: "empty", world: createWorld(createEmptyRaid(), 123) }),
    JSON.stringify({ startTick: 0, frames: [{ arbitrary: "data" }] }),
    "",
  ].join("\n"));

  expect(await listReplays(SESSION)).toEqual([{
    pull: 3, raidId: "unknown", ticks: 0, supported: false, formatVersion: null,
  }]);
  await expect(loadReplay(SESSION, 3)).rejects.toMatchObject({
    code: "unsupported_format",
    receivedVersion: null,
  });
});

test("accepts CRLF, blank lines and a missing trailing newline", async () => {
  const frame = { intents: {}, botsInvincible: false };
  await writePull(4, `${headerLine()}\r\n\r\n${JSON.stringify({ startTick: 0, frames: [frame, frame] })}`);

  const loaded = await loadReplay(SESSION, 4);
  expect(loaded?.frames).toEqual([frame, frame]);
  expect(await listReplays(SESSION)).toEqual([{
    pull: 4, raidId: "debug/test", ticks: 2, supported: true, formatVersion: REPLAY_FORMAT_VERSION,
  }]);
});

test("reads records that straddle stream chunk boundaries, including multi-byte characters", async () => {
  // Records of varying length, well past the stream's chunk size, so both JSON
  // and individual UTF-8 characters land across chunk boundaries.
  const frames: Frame[] = [];
  const lines = [headerLine()];
  for (let batch = 0; batch < 200; batch++) {
    const batchFrames: Frame[] = [];
    for (let i = 0; i < 3; i++) {
      batchFrames.push({ intents: {}, botsInvincible: false, note: "☃é✦".repeat(137 + batch + i) } as Frame);
    }
    lines.push(JSON.stringify({ startTick: batch * 3, frames: batchFrames }));
    frames.push(...batchFrames);
  }
  await writePull(5, lines.join("\n") + "\n");
  expect((await Bun.file(pullPath(5)).stat()).size).toBeGreaterThan(1_000_000);

  const loaded = await loadReplay(SESSION, 5);
  expect(loaded?.frames).toEqual(frames);
  expect(await listReplays(SESSION)).toEqual([{
    pull: 5, raidId: "debug/test", ticks: frames.length, supported: true, formatVersion: REPLAY_FORMAT_VERSION,
  }]);
});

test.each([
  ["missing header", "{}\n", "corrupt_data"],
  ["unparsable header", "not json\n", "corrupt_data"],
  ["invalid raid id", `${headerLine({ raidId: "" })}\n`, "corrupt_data"],
  ["invalid world", `${headerLine({ world: {} })}\n`, "corrupt_data"],
  ["invalid batch", `${headerLine()}\n${JSON.stringify({ startTick: -1, frames: [] })}\n`, "corrupt_data"],
  ["invalid frame", `${headerLine()}\n${JSON.stringify({ startTick: 0, frames: [{ intents: {} }] })}\n`, "corrupt_data"],
  ["corrupt tail", `${headerLine()}\n{"startTick":0,"frames":[]}\ngarbage\n`, "corrupt_data"],
  ["truncated tail", `${headerLine()}\n{"startTick":0,"frames":[`, "corrupt_data"],
])("rejects %s", async (_name, body, code) => {
  await writePull(6, body);
  await expect(loadReplay(SESSION, 6)).rejects.toMatchObject({ code });
  // Listing validates the whole file too, so a broken replay is not summarized.
  expect(await listReplays(SESSION)).toEqual([]);
});

test("reports an unsupported version even when the frame data behind it is corrupt", async () => {
  await writePull(7, `${headerLine({ formatVersion: REPLAY_FORMAT_VERSION + 1 })}\ngarbage\n`);

  expect(await listReplays(SESSION)).toEqual([{
    pull: 7, raidId: "unknown", ticks: 0, supported: false, formatVersion: REPLAY_FORMAT_VERSION + 1,
  }]);
  await expect(loadReplay(SESSION, 7)).rejects.toMatchObject({
    code: "unsupported_format",
    receivedVersion: REPLAY_FORMAT_VERSION + 1,
  });
});

test("returns null for a missing replay", async () => {
  expect(await loadReplay(SESSION, 99)).toBeNull();
});

test("a superseded format lists as unsupported and refuses to load", async () => {
  const { sections, avoidableSources, ...legacyWorld } = createWorld(createEmptyRaid(), 123);
  const frame: Frame = { intents: {}, botsInvincible: false };
  await writePull(11, `${headerLine({ formatVersion: 1, world: legacyWorld })}\n`
    + `${JSON.stringify({ startTick: 0, frames: [frame] })}\n`);

  expect(await listReplays(SESSION)).toEqual([{
    pull: 11, raidId: "unknown", ticks: 0, supported: false, formatVersion: 1,
  }]);
  await expect(loadReplay(SESSION, 11)).rejects.toMatchObject({ code: "unsupported_format" });
});

test("a current recording carries the review payload through the round trip", async () => {
  const world = createWorld(createEmptyRaid(), 123);
  const log = createSessionLog(`${SESSION}-pull-12`);
  pullPath(12);
  log.header("debug/test", world);
  log.frame(0, [{ intents: {}, botsInvincible: false }]);
  log.close();

  const loaded = await loadReplay(SESSION, 12);
  expect(loaded?.formatVersion).toBe(REPLAY_FORMAT_VERSION);
  expect(loaded?.world.sections).toEqual([]);
  expect(loaded?.world.avoidableSources).toEqual({});
});
