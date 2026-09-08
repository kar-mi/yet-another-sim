import type { Frame } from "./protocol";
import type { MechanicSection, World } from "./types";


export const REPLAY_FORMAT_VERSION = 2;
export const SNAPSHOT_FORMAT_VERSION = 1;

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
  events: ReplayEvent[];
  sections: MechanicSection[];
  players: ReplayPlayerLabel[];
};

