import { readdir } from "node:fs/promises";
import { join } from "path";
import { RaidIdSchema, SessionIdSchema, type Frame } from "@shared/protocol";
import type { World } from "@shared/types";
import { REPLAY_FORMAT_VERSION, type ReplayData, type ReplayErrorCode, type ReplaySummary } from "@shared/replay";
import { sanitizeSessionId } from "./logger";

const SESSION_LOG_DIR = join(import.meta.dir, "..", "..", "logs", "sessions");

export { type ReplayData, type ReplaySummary } from "@shared/replay";

export class ReplayReadError extends Error {
  constructor(
    readonly code: Exclude<ReplayErrorCode, "request_failed">,
    message: string,
    readonly receivedVersion?: number | null,
  ) {
    super(message);
  }
}

function safeSessionId(sessionId: string): string | null {
  const parsed = SessionIdSchema.safeParse(sessionId);
  return parsed.success ? sanitizeSessionId(parsed.data) : null;
}

function isFrame(value: unknown): value is Frame {
  return !!value
    && typeof value === "object"
    && typeof (value as { botsInvincible?: unknown }).botsInvincible === "boolean"
    && !!(value as { intents?: unknown }).intents
    && typeof (value as { intents?: unknown }).intents === "object";
}

async function readReplayFile(path: string): Promise<ReplayData | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;

  let lines: string[];
  try {
    lines = (await file.text()).trim().split("\n").filter(Boolean);
  } catch {
    throw new ReplayReadError("corrupt_data", "Replay could not be read");
  }
  let header: { header?: unknown; formatVersion?: unknown; raidId?: unknown; world?: unknown };
  try {
    header = JSON.parse(lines[0] ?? "{}");
  } catch {
    throw new ReplayReadError("corrupt_data", "Replay header is invalid");
  }
  if (header.header !== true) throw new ReplayReadError("corrupt_data", "Replay header is missing");
  const receivedVersion = Number.isInteger(header.formatVersion) ? Number(header.formatVersion) : null;
  if (receivedVersion !== REPLAY_FORMAT_VERSION) {
    throw new ReplayReadError("unsupported_format", "Replay format is not supported", receivedVersion);
  }
  if (typeof header.raidId !== "string" || !RaidIdSchema.safeParse(header.raidId).success) {
    throw new ReplayReadError("corrupt_data", "Replay raid id is invalid");
  }
  if (!header.world || typeof header.world !== "object" || !("players" in header.world) || !("arena" in header.world)) {
    throw new ReplayReadError("corrupt_data", "Replay world is invalid");
  }

  const frames: Frame[] = [];
  for (const line of lines.slice(1)) {
    let chunk: { startTick?: unknown; frames?: unknown };
    try { chunk = JSON.parse(line); } catch { throw new ReplayReadError("corrupt_data", "Replay frame data is invalid"); }
    if (!Number.isInteger(chunk.startTick) || Number(chunk.startTick) < 0 || !Array.isArray(chunk.frames)) {
      throw new ReplayReadError("corrupt_data", "Replay frame batch is invalid");
    }
    if (!chunk.frames.every(isFrame)) throw new ReplayReadError("corrupt_data", "Replay frame is invalid");
    frames.push(...chunk.frames as Frame[]);
  }
  return { formatVersion: REPLAY_FORMAT_VERSION, raidId: header.raidId, world: header.world as World, frames };
}

export async function listReplays(sessionId: string): Promise<ReplaySummary[]> {
  const safeId = safeSessionId(sessionId);
  if (!safeId) throw new Error("Invalid session id");

  const namePattern = new RegExp(`^${safeId}-pull-(\\d+)\\.jsonl$`);
  const entries = await readdir(SESSION_LOG_DIR).catch(() => []);
  const replays: ReplaySummary[] = [];

  for (const name of entries) {
    const match = name.match(namePattern);
    if (!match) continue;
    const pull = Number(match[1]);
    if (!Number.isInteger(pull) || pull < 0) continue;
    try {
      const replay = await readReplayFile(join(SESSION_LOG_DIR, name));
      if (replay) replays.push({ pull, raidId: replay.raidId, ticks: replay.frames.length, supported: true, formatVersion: replay.formatVersion });
    } catch (error) {
      if (!(error instanceof ReplayReadError) || error.code !== "unsupported_format") continue;
      replays.push({ pull, raidId: "unknown", ticks: 0, supported: false, formatVersion: error.receivedVersion ?? null });
    }
  }
  return replays.sort((a, b) => a.pull - b.pull);
}

export async function loadReplay(sessionId: string, pull: number): Promise<ReplayData | null> {
  const safeId = safeSessionId(sessionId);
  if (!safeId) throw new Error("Invalid session id");
  if (!Number.isInteger(pull) || pull < 0) return null;
  return readReplayFile(join(SESSION_LOG_DIR, `${safeId}-pull-${pull}.jsonl`));
}
