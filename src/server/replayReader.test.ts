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

const SESSION_LOG_DIR = join(import.meta.dir, "..", "..", "logs", "sessions");
const FILE = join(SESSION_LOG_DIR, "replay-reader-test-pull-2.jsonl");
const DT = 1 / 60;

afterEach(() => {
  if (existsSync(FILE)) rmSync(FILE);
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
  const log = createSessionLog("replay-reader-test-pull-2");
  log.header("empty", createWorld(createEmptyRaid(), 123));
  log.frame(0, frames);
  log.close();

  expect(await listReplays("replay-reader-test")).toEqual([{ pull: 2, raidId: "empty", ticks: 2 }]);

  const loaded = await loadReplay("replay-reader-test", 2);
  expect(loaded?.raidId).toBe("empty");
  expect(loaded?.frames).toEqual(frames);
  expect(worldHash(replay(loaded!.world, loaded!.frames))).toBe(worldHash(replay(loaded!.world, loaded!.frames)));
});
