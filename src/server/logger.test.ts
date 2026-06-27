import { afterEach, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "path";
import { createSessionLog } from "./logger";

const SESSION_LOG_DIR = join(import.meta.dir, "..", "..", "logs", "sessions");

afterEach(() => {
  const file = join(SESSION_LOG_DIR, "logger-batch-test.jsonl");
  if (existsSync(file)) rmSync(file);
});

test("session replay log batches adjacent frame writes", async () => {
  const log = createSessionLog("logger-batch-test");
  log.frame(0, [{ intents: {}, botsInvincible: false }]);
  log.frame(1, [{ intents: {}, botsInvincible: false }]);
  log.close();

  const lines = (await Bun.file(join(SESSION_LOG_DIR, "logger-batch-test.jsonl")).text()).trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0])).toMatchObject({
    startTick: 0,
    frames: [
      { intents: {}, botsInvincible: false },
      { intents: {}, botsInvincible: false },
    ],
  });
});
