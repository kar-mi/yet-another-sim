import { existsSync, mkdirSync } from "node:fs";
import { join } from "path";
import { consoleSink, formatRecord, logger, parseLevel, type LogRecord, type Sink } from "@shared/logger";
import type { SessionLog } from "./sessionRaid";
import type { Frame } from "@model/protocol";
import { REPLAY_FORMAT_VERSION } from "@model/replay";

const ROOT = join(import.meta.dir, "..", "..");
const LOG_DIR = join(ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "sim.log");
const SESSION_LOG_DIR = join(LOG_DIR, "sessions");
const SESSION_FRAME_LOG_INTERVAL_MS = 250;

const activeSessionLogs = new Set<SessionLog>();
let flushFileSink: () => void = () => {};

function createFileSink(): Sink {
  mkdirSync(LOG_DIR, { recursive: true });
  const writer = Bun.file(LOG_FILE).writer();

  let dirty = false;
  const flush = () => {
    if (!dirty) return;
    dirty = false;
    writer.flush();
  };
  setInterval(flush, 1000).unref();
  flushFileSink = flush;
  process.on("exit", flush);

  return (record: LogRecord) => {
    writer.write(formatRecord(record) + "\n");
    dirty = true;
  };
}

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  flushFileSink();
  for (const sessionLog of [...activeSessionLogs]) sessionLog.close();
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, shutdown);
}

const logLevel = parseLevel(Bun.env.LOG_LEVEL, "warn");

const environment = Bun.env.ENVIRONMENT || "production";
export const isDevelopment = environment === "development";

logger.configure({
  level: logLevel,
  sinks: [consoleSink, createFileSink()],
});

export function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function createSessionLog(sessionId: string): SessionLog {
  mkdirSync(SESSION_LOG_DIR, { recursive: true });
  let safeId = sanitizeSessionId(sessionId);
  const pullMatch = safeId.match(/^(.*-pull-)(\d+)$/);
  if (pullMatch) {
    let pull = Number(pullMatch[2]);
    while (existsSync(join(SESSION_LOG_DIR, `${safeId}.jsonl`))) {
      pull++;
      safeId = `${pullMatch[1]}${pull}`;
    }
  }
  const writer = Bun.file(join(SESSION_LOG_DIR, `${safeId}.jsonl`)).writer();

  let dirty = false;
  let pendingStartTick: number | null = null;
  const pendingFrames: Frame[] = [];
  const writePendingFrames = () => {
    if (pendingStartTick === null || pendingFrames.length === 0) return;
    writer.write(JSON.stringify({ startTick: pendingStartTick, frames: pendingFrames }) + "\n");
    pendingStartTick = null;
    pendingFrames.length = 0;
    dirty = true;
  };
  const flush = () => {
    writePendingFrames();
    if (!dirty) return;
    dirty = false;
    writer.flush();
  };
  const timer = setInterval(flush, SESSION_FRAME_LOG_INTERVAL_MS);
  timer.unref();

  const sessionLog: SessionLog = {
    header(raidId, world): void {
      writePendingFrames();
      writer.write(JSON.stringify({ header: true, formatVersion: REPLAY_FORMAT_VERSION, raidId, world }) + "\n");
      dirty = true;
    },
    frame(startTick: number, frames: Frame[]): void {
      if (pendingStartTick === null) pendingStartTick = startTick;
      pendingFrames.push(...frames);
    },
    close(): void {
      clearInterval(timer);
      flush();
      writer.end();
      activeSessionLogs.delete(sessionLog);
    },
  };
  activeSessionLogs.add(sessionLog);
  return sessionLog;
}

export { logger };
