import type { Frame } from "./protocol";
import type { MechanicSection, World } from "./types";

// Format 2 adds the review payload to the recorded tick-0 world: `avoidableSources` and `sections`.
// Format 1 recordings still play back, with no review data.
export const REPLAY_FORMAT_VERSION = 2;
const SUPPORTED_REPLAY_FORMAT_VERSIONS: readonly number[] = [1, 2];
export const REPLAY_INSIGHTS_MIN_VERSION = 2;
export const SNAPSHOT_FORMAT_VERSION = 1;

export function isSupportedReplayFormat(version: unknown): version is number {
  return typeof version === "number" && SUPPORTED_REPLAY_FORMAT_VERSIONS.includes(version);
}

export type ReplaySummary = {
  pull: number;
  raidId: string;
  ticks: number;
  supported: boolean;
  formatVersion: number | null;
};

export type ReplayData = {
  formatVersion: number;
  raidId: string;
  world: World;
  frames: Frame[];
};

export type ReplayErrorCode = "not_found" | "unsupported_format" | "corrupt_data" | "request_failed";

export type ReplayErrorResponse = {
  error: ReplayErrorCode;
  message: string;
  expectedVersion?: number;
  receivedVersion?: number | null;
};

// A single reviewable moment in a pull, collected by client/replayInsights.ts.
export type ReplayEvent = {
  id: string;
  // Replay-relative tick, in the transport's seek convention: seeking here shows the state *after*
  // this event resolved.
  tick: number;
  playerId: string;
  playerLabel: string;
  kind: "hit" | "death";
  // "<eventId>", "<eventId>:<slot>", a status effect id, or "arena" for a fall.
  sourceId: string;
  sourceName: string;
  sectionId?: string;
  // Hits only. 0 when invincibility or full mitigation prevented all of the damage.
  hpLoss?: number;
  // Set on a death caused by a recorded avoidable hit in the same tick, pointing at that hit.
  hitEventId?: string;
};

export type ReplayPlayerLabel = { id: string; label: string };

export type ReplayInsights = {
  // False for pre-REPLAY_INSIGHTS_MIN_VERSION recordings, which is not the same as a newer
  // recording whose event list is legitimately empty.
  available: boolean;
  events: ReplayEvent[];
  sections: MechanicSection[];
  players: ReplayPlayerLabel[];
};

