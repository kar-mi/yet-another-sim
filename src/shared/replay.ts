import type { Frame } from "./protocol";
import type { World } from "./types";

export const REPLAY_FORMAT_VERSION = 1;
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
