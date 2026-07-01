import { readdir } from "node:fs/promises";
import { join } from "path";
import { SessionIdSchema, type Frame } from "@shared/protocol";
import type { World } from "@shared/types";

const SESSION_LOG_DIR = join(import.meta.dir, "..", "..", "logs", "sessions");

export type ReplaySummary = { pull: number; raidId: string; ticks: number };
export type ReplayData = { raidId: string; world: World; frames: Frame[] };

function safeSessionId(sessionId: string): string | null {
  const parsed = SessionIdSchema.safeParse(sessionId);
  return parsed.success ? parsed.data.replace(/[^a-zA-Z0-9_-]/g, "_") : null;
}

async function readReplayFile(path: string): Promise<ReplayData | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;

  const lines = (await file.text()).trim().split("\n").filter(Boolean);
  const header = JSON.parse(lines[0] ?? "{}") as { raidId?: unknown; world?: unknown };
  if (typeof header.raidId !== "string" || !header.world) return null;

  const frames: Frame[] = [];
  for (const line of lines.slice(1)) {
    const chunk = JSON.parse(line) as { frames?: unknown };
    if (!Array.isArray(chunk.frames)) return null;
    frames.push(...chunk.frames as Frame[]);
  }
  return { raidId: header.raidId, world: header.world as World, frames };
}

export async function listReplays(sessionId: string): Promise<ReplaySummary[]> {
  const safeId = safeSessionId(sessionId);
  if (!safeId) throw new Error("Invalid session id");

  const prefix = `${safeId}-pull-`;
  const suffix = ".jsonl";
  const entries = await readdir(SESSION_LOG_DIR).catch(() => []);
  const replays: ReplaySummary[] = [];

  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    const pull = Number(name.slice(prefix.length, -suffix.length));
    if (!Number.isInteger(pull) || pull < 0) continue;
    const replay = await readReplayFile(join(SESSION_LOG_DIR, name)).catch(() => null);
    if (replay) replays.push({ pull, raidId: replay.raidId, ticks: replay.frames.length });
  }
  return replays.sort((a, b) => a.pull - b.pull);
}

export async function loadReplay(sessionId: string, pull: number): Promise<ReplayData | null> {
  const safeId = safeSessionId(sessionId);
  if (!safeId) throw new Error("Invalid session id");
  return readReplayFile(join(SESSION_LOG_DIR, `${safeId}-pull-${pull}.jsonl`)).catch(() => null);
}
