import {
  REPLAY_FORMAT_VERSION,
  type ReplayData,
  type ReplayErrorCode,
  type ReplayErrorResponse,
  type ReplaySummary,
} from "@shared/replay";

const REPLAY_CACHE_MAX = 5;
type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ReplayRepositoryError extends Error {
  constructor(readonly code: ReplayErrorCode, message: string) {
    super(message);
  }
}

export class ReplayRepository {
  private readonly cache = new Map<string, ReplayData>();

  constructor(private readonly request: Request = fetch) {}

  async list(sessionId: string): Promise<ReplaySummary[]> {
    const response = await this.request(`/api/replays/${encodeURIComponent(sessionId)}`);
    if (!response.ok) throw new ReplayRepositoryError("request_failed", `Failed to load replay list: ${response.status}`);
    const value: unknown = await response.json();
    if (!Array.isArray(value)) throw new ReplayRepositoryError("corrupt_data", "Invalid replay list");
    return value.map(parseReplaySummary);
  }

  async load(sessionId: string, pull: number): Promise<ReplayData> {
    const key = `${sessionId}:${pull}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const response = await this.request(`/api/replays/${encodeURIComponent(sessionId)}/${pull}`);
    if (!response.ok) throw await responseError(response);
    const replay = parseReplayData(await response.json());
    this.cache.set(key, replay);
    if (this.cache.size > REPLAY_CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    return replay;
  }
}

function parseReplaySummary(value: unknown): ReplaySummary {
  if (!value || typeof value !== "object") throw new ReplayRepositoryError("corrupt_data", "Invalid replay summary");
  const row = value as Partial<ReplaySummary>;
  if (!Number.isInteger(row.pull) || typeof row.raidId !== "string" || !Number.isInteger(row.ticks)
      || typeof row.supported !== "boolean" || (row.formatVersion !== null && !Number.isInteger(row.formatVersion))) {
    throw new ReplayRepositoryError("corrupt_data", "Invalid replay summary");
  }
  return row as ReplaySummary;
}

function parseReplayData(value: unknown): ReplayData {
  if (!value || typeof value !== "object") throw new ReplayRepositoryError("corrupt_data", "Invalid replay data");
  const replay = value as Partial<ReplayData>;
  if (replay.formatVersion !== REPLAY_FORMAT_VERSION) {
    throw new ReplayRepositoryError("unsupported_format", `Unsupported replay format ${String(replay.formatVersion)}`);
  }
  if (typeof replay.raidId !== "string" || !replay.world || typeof replay.world !== "object" || !Array.isArray(replay.frames)) {
    throw new ReplayRepositoryError("corrupt_data", "Invalid replay data");
  }
  return replay as ReplayData;
}

async function responseError(response: Response): Promise<ReplayRepositoryError> {
  if (response.status === 404) return new ReplayRepositoryError("not_found", "Replay not found");
  try {
    const body = await response.json() as Partial<ReplayErrorResponse>;
    if (body.error === "unsupported_format" || body.error === "corrupt_data") {
      return new ReplayRepositoryError(body.error, typeof body.message === "string" ? body.message : "Replay could not be loaded");
    }
  } catch {}
  return new ReplayRepositoryError("request_failed", `Failed to load replay: ${response.status}`);
}

export const replayRepository = new ReplayRepository();
