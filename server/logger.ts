// Server-side logger setup: console + batched append to logs/sim.log.
// Importing this module for its side effect configures the shared `logger`.
import { mkdirSync } from "node:fs";
import { join } from "path";
import { consoleSink, formatRecord, logger, parseLevel, type LogRecord, type Sink } from "../src/shared/logger";

const ROOT = join(import.meta.dir, "..");
const LOG_DIR = join(ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "sim.log");

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
  for (const signal of ["exit", "SIGINT", "SIGTERM"] as const) {
    process.on(signal, flush);
  }

  return (record: LogRecord) => {
    writer.write(formatRecord(record) + "\n");
    dirty = true;
  };
}

logger.configure({
  level: parseLevel(process.env.LOG_LEVEL, "warn"),
  sinks: [consoleSink, createFileSink()],
});

export { logger };
