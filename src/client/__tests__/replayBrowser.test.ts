import { describe, expect, test } from "bun:test";
import type { ReplaySummary } from "@shared/replay";
import { replayMatches } from "../ui/ReplayBrowser";

const summary: ReplaySummary = {
  pull: 3,
  raidId: "endwalker/p8s",
  ticks: 1800,
  supported: true,
  formatVersion: 1,
};

describe("replay browser search", () => {
  test("an empty query keeps every recording", () => {
    expect(replayMatches(summary, "")).toBe(true);
  });

  test("matches on pull number, raid id and duration", () => {
    expect(replayMatches(summary, "pull 3")).toBe(true);
    expect(replayMatches(summary, "p8s")).toBe(true);
    expect(replayMatches(summary, "30s")).toBe(true);
  });

  test("rejects anything else", () => {
    expect(replayMatches(summary, "pull 4")).toBe(false);
  });
});
