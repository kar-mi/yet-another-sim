// Server-side logger setup: console + batched append to logs/sim.log.
// Importing this module for its side effect configures the shared `logger`.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "path";
import { consoleSink, formatRecord, logger, parseLevel, type LogRecord, type Sink } from "@shared/logger";
import type { SessionLog } from "./sessionRaid";
import type { Frame } from "@shared/protocol";
import { REPLAY_FORMAT_VERSION } from "@shared/replay";

const ROOT = join(import.meta.dir, "..", "..");
const LOG_DIR = join(ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "sim.log");
const SESSION_LOG_DIR = join(LOG_DIR, "sessions");
const SESSION_FRAME_LOG_INTERVAL_MS = 250;

// Per-pull replay logs still open, flushed/closed on shutdown so buffered
// input frames aren't lost when sessions are active at exit.
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

// Registering signal listeners overrides Node's default of terminating on
// SIGINT/SIGTERM, so the handler must flush every writer and then exit itself.
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

// LOG_LEVEL governs logging verbosity only.
export const logLevel = parseLevel(Bun.env.LOG_LEVEL, "warn");

// ENVIRONMENT governs dev-only behavior independent of log verbosity: inline
// build sourcemaps and the client __YAS_DEBUG__ HUD. Defaults to production so a
// bare deploy never ships dev artifacts; set ENVIRONMENT=development to enable.
export const environment = Bun.env.ENVIRONMENT || "production";
export const isDevelopment = environment === "development";

logger.configure({
  level: logLevel,
  sinks: [consoleSink, createFileSink()],
});

// Per-pull input replay log: one batched JSONL file per pull at logs/sessions/<id>.jsonl,
// written regardless of LOG_LEVEL. In server-relayed lockstep the server no longer simulates, so
// the input frames it relays ARE the pull. Each pull opens with a header line carrying the
// tick-0 world (seed included) + raid id; replaying the subsequent frame lines against that world
// reproduces the entire pull deterministically.
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
