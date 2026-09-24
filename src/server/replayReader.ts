import { readdir } from "node:fs/promises";
import { join } from "path";
import { EMPTY_RAID_ID, RaidIdSchema, SessionIdSchema, type Frame } from "@model/protocol";
import type { World } from "@model/types";
import { REPLAY_FORMAT_VERSION, type ReplayData, type ReplayErrorCode, type ReplaySummary } from "@model/replay";
import { sanitizeSessionId } from "./logger";

const SESSION_LOG_DIR = join(import.meta.dir, "..", "..", "logs", "sessions");

export { type ReplayData, type ReplaySummary } from "@model/replay";

export class ReplayReadError extends Error {
  constructor(
    readonly code: Exclude<ReplayErrorCode, "request_failed">,
    message: string,
    readonly receivedVersion?: number | null,
  ) {
    super(message);
  }
}

type ReplayHeader = { raidId: string; world: World };

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

function parseHeader(record: unknown): ReplayHeader {
  const header = record as { header?: unknown; formatVersion?: unknown; raidId?: unknown; world?: unknown };
  if (!header || typeof header !== "object" || header.header !== true) {
    throw new ReplayReadError("corrupt_data", "Replay header is missing");
  }
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
  return { raidId: header.raidId, world: header.world as World };
}

function parseBatch(record: unknown): Frame[] {
  const batch = record as { startTick?: unknown; frames?: unknown };
  if (!batch || typeof batch !== "object"
    || !Number.isInteger(batch.startTick) || Number(batch.startTick) < 0 || !Array.isArray(batch.frames)) {
    throw new ReplayReadError("corrupt_data", "Replay frame batch is invalid");
  }
  if (!batch.frames.every(isFrame)) throw new ReplayReadError("corrupt_data", "Replay frame is invalid");
  return batch.frames as Frame[];
}

async function forEachRecord(path: string, onRecord: (record: unknown, index: number) => void): Promise<void> {
  const reader = Bun.file(path).stream().getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let index = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const parsed = Bun.JSONL.parseChunk(pending);
      pending = pending.slice(parsed.read);
      for (const record of parsed.values) onRecord(record, index++);
      if (parsed.error) throw new ReplayReadError("corrupt_data", recordMessage(index));
      if (done) {
        if (pending.trim()) throw new ReplayReadError("corrupt_data", recordMessage(index));
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function recordMessage(index: number): string {
  return index === 0 ? "Replay header is invalid" : "Replay frame data is invalid";
}

async function readReplayFile(path: string, keepFrames: boolean): Promise<(ReplayData & { ticks: number }) | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;

  const state = { header: null as ReplayHeader | null, ticks: 0 };
  const frames: Frame[] = [];
  try {
    await forEachRecord(path, (record, index) => {
      if (index === 0) {
        state.header = parseHeader(record);
        return;
      }
      const batch = parseBatch(record);
      state.ticks += batch.length;
      if (keepFrames) for (const frame of batch) frames.push(frame);
    });
  } catch (error) {
    if (error instanceof ReplayReadError) throw error;
    throw new ReplayReadError("corrupt_data", "Replay could not be read");
  }
  if (!state.header) throw new ReplayReadError("corrupt_data", "Replay header is missing");

  return {
    formatVersion: REPLAY_FORMAT_VERSION,
    raidId: state.header.raidId,
    world: state.header.world,
    frames,
    ticks: state.ticks,
  };
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
      const replay = await readReplayFile(join(SESSION_LOG_DIR, name), false);
      if (replay && replay.raidId !== EMPTY_RAID_ID) {
        replays.push({ pull, raidId: replay.raidId, ticks: replay.ticks, supported: true, formatVersion: replay.formatVersion });
      }
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
  const replay = await readReplayFile(join(SESSION_LOG_DIR, `${safeId}-pull-${pull}.jsonl`), true);
  if (!replay) return null;
  return { formatVersion: replay.formatVersion, raidId: replay.raidId, world: replay.world, frames: replay.frames };
}
