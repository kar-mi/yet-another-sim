import { readdir } from "node:fs/promises";
import { join } from "path";
import { RaidIdSchema, SessionIdSchema, type Frame } from "@shared/protocol";
import type { World } from "@shared/types";
import { sanitizeSessionId } from "./logger";

const SESSION_LOG_DIR = join(import.meta.dir, "..", "..", "logs", "sessions");

export type ReplaySummary = { pull: number; raidId: string; ticks: number };
export type ReplayData = { raidId: string; world: World; frames: Frame[] };

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

  const lines = (await file.text()).trim().split("\n").filter(Boolean);
  const header = JSON.parse(lines[0] ?? "{}") as { header?: unknown; raidId?: unknown; world?: unknown };
  if (header.header !== true || typeof header.raidId !== "string" || !RaidIdSchema.safeParse(header.raidId).success) return null;
  if (!header.world || typeof header.world !== "object" || !("players" in header.world) || !("arena" in header.world)) return null;

  const frames: Frame[] = [];
  for (const line of lines.slice(1)) {
    const chunk = JSON.parse(line) as { startTick?: unknown; frames?: unknown };
    if (!Number.isInteger(chunk.startTick) || Number(chunk.startTick) < 0 || !Array.isArray(chunk.frames)) return null;
    if (!chunk.frames.every(isFrame)) return null;
    frames.push(...chunk.frames as Frame[]);
  }
  return { raidId: header.raidId, world: header.world as World, frames };
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
    const replay = await readReplayFile(join(SESSION_LOG_DIR, name)).catch(() => null);
    if (replay) replays.push({ pull, raidId: replay.raidId, ticks: replay.frames.length });
  }
  return replays.sort((a, b) => a.pull - b.pull);
}

export async function loadReplay(sessionId: string, pull: number): Promise<ReplayData | null> {
  const safeId = safeSessionId(sessionId);
  if (!safeId) throw new Error("Invalid session id");
  if (!Number.isInteger(pull) || pull < 0) return null;
  return readReplayFile(join(SESSION_LOG_DIR, `${safeId}-pull-${pull}.jsonl`)).catch(() => null);
}
