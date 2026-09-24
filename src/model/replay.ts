import type { Frame } from "./protocol";
import type { MechanicSection, World } from "./types";


export const REPLAY_FORMAT_VERSION = 3;
export const SNAPSHOT_FORMAT_VERSION = 2;

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

export type ReplayEvent = {
  id: string;
  tick: number;
  playerId: string;
  playerLabel: string;
  kind: "hit" | "death";
  sourceId: string;
  sourceName: string;
  sectionId?: string;
  hpLoss?: number;
  hitEventId?: string;
};

export type ReplayPlayerLabel = { id: string; label: string };

export type ReplayInsights = {
  events: ReplayEvent[];
  sections: MechanicSection[];
  players: ReplayPlayerLabel[];
};

