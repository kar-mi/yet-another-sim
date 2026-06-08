// Server-side logger setup: console + batched append to logs/sim.log.
// Importing this module for its side effect configures the shared `logger`.
import { mkdirSync } from "node:fs";
import { join } from "path";
import { consoleSink, formatRecord, logger, parseLevel, type LogRecord, type Sink } from "../src/shared/logger";
import type { SessionLog } from "./session";
import type { LogEntry } from "../src/shared/types";

const ROOT = join(import.meta.dir, "..");
const LOG_DIR = join(ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "sim.log");
const SESSION_LOG_DIR = join(LOG_DIR, "sessions");

// Per-session logs still open, flushed/closed on shutdown so buffered
// simulation events aren't lost when sessions are active at exit.
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

logger.configure({
  level: parseLevel(Bun.env.LOG_LEVEL, "warn"),
  sinks: [consoleSink, createFileSink()],
});

// Per-session simulation event log: one batched file per session at
// logs/sessions/<id>.log, written regardless of LOG_LEVEL.
export function createSessionLog(sessionId: string): SessionLog {
  mkdirSync(SESSION_LOG_DIR, { recursive: true });
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const writer = Bun.file(join(SESSION_LOG_DIR, `${safeId}.log`)).writer();

  let dirty = false;
  const flush = () => {
    if (!dirty) return;
    dirty = false;
    writer.flush();
  };
  const timer = setInterval(flush, 1000);
  timer.unref();

  const sessionLog: SessionLog = {
    event(entry: LogEntry): void {
      writer.write(`t=${entry.t.toFixed(2)} ${entry.event} ${entry.mechanic} ${entry.playerId}\n`);
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
