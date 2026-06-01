// Minimal leveled, category-tagged logger shared by server and client.
// Calls are gated on level before any work, so disabled levels cost nothing.

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

export type LogRecord = {
  time: number;
  level: Exclude<LogLevel, "silent">;
  category: string;
  msg: string;
  fields?: Record<string, unknown>;
};

export type Sink = (record: LogRecord) => void;

export function parseLevel(value: unknown, fallback: LogLevel): LogLevel {
  return typeof value === "string" && value in LEVEL_WEIGHT ? (value as LogLevel) : fallback;
}

export function formatRecord(record: LogRecord): string {
  const ts = new Date(record.time).toISOString().slice(11, 23); // hh:mm:ss.mmm
  const level = record.level.toUpperCase().padEnd(5);
  let line = `[${ts}] ${level} ${record.category} ${record.msg}`;
  if (record.fields) {
    for (const [key, value] of Object.entries(record.fields)) {
      line += ` ${key}=${formatValue(value)}`;
    }
  }
  return line;
}

function formatValue(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

class Logger {
  private minWeight = LEVEL_WEIGHT.info;
  private sinks: Sink[] = [];

  configure(options: { level?: LogLevel; sinks?: Sink[] }): void {
    if (options.level) this.minWeight = LEVEL_WEIGHT[options.level];
    if (options.sinks) this.sinks = options.sinks;
  }

  private emit(level: Exclude<LogLevel, "silent">, category: string, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < this.minWeight || this.sinks.length === 0) return;
    const record: LogRecord = { time: Date.now(), level, category, msg, fields };
    for (const sink of this.sinks) sink(record);
  }

  debug(category: string, msg: string, fields?: Record<string, unknown>): void {
    this.emit("debug", category, msg, fields);
  }
  info(category: string, msg: string, fields?: Record<string, unknown>): void {
    this.emit("info", category, msg, fields);
  }
  warn(category: string, msg: string, fields?: Record<string, unknown>): void {
    this.emit("warn", category, msg, fields);
  }
  error(category: string, msg: string, fields?: Record<string, unknown>): void {
    this.emit("error", category, msg, fields);
  }
}

export const logger = new Logger();

export function consoleSink(record: LogRecord): void {
  const line = formatRecord(record);
  if (record.level === "error") console.error(line);
  else if (record.level === "warn") console.warn(line);
  else console.log(line);
}
