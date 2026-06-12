// Server-side logger setup: console + batched append to logs/sim.log.
// Importing this module for its side effect configures the shared `logger`.
import { mkdirSync } from "node:fs";
import { join } from "path";
import { consoleSink, formatRecord, logger, parseLevel, type LogRecord, type Sink } from "../shared/logger";
import type { SessionLog } from "./session";
import type { Frame } from "../shared/protocol";

const ROOT = join(import.meta.dir, "..", "..");
const LOG_DIR = join(ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "sim.log");
const SESSION_LOG_DIR = join(LOG_DIR, "sessions");

// Per-session replay logs still open, flushed/closed on shutdown so buffered
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

export const logLevel = parseLevel(Bun.env.LOG_LEVEL, "warn");
export const debugEnabled = logLevel === "debug";

logger.configure({
  level: logLevel,
  sinks: [consoleSink, createFileSink()],
});

// Per-session input replay log: one batched JSONL file per session at logs/sessions/<id>.jsonl,
// written regardless of LOG_LEVEL. In server-relayed lockstep the server no longer simulates, so
// the input frames it relays ARE the session. Each pull opens with a header line carrying the
// tick-0 world (seed included) + raid id; replaying the subsequent frame lines against that world
// reproduces the entire pull deterministically.
export function createSessionLog(sessionId: string): SessionLog {
  mkdirSync(SESSION_LOG_DIR, { recursive: true });
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const writer = Bun.file(join(SESSION_LOG_DIR, `${safeId}.jsonl`)).writer();

  let dirty = false;
  const flush = () => {
    if (!dirty) return;
    dirty = false;
    writer.flush();
  };
  const timer = setInterval(flush, 1000);
  timer.unref();

  const sessionLog: SessionLog = {
    header(raidId, world): void {
      writer.write(JSON.stringify({ header: true, raidId, world }) + "\n");
      dirty = true;
    },
    frame(startTick: number, frames: Frame[]): void {
      writer.write(JSON.stringify({ startTick, frames }) + "\n");
      dirty = true;
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
