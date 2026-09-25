import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { applyBotPatterns, loadBotPatterns } from "../schema/raidLoader";
import { baseRaid, loadRaid } from "./helpers";

test("bot pattern hints are carried onto the raid and sorted into the world", () => {
  const raid = applyBotPatterns(loadRaid(baseRaid), loadBotPatterns({
    players: {},
    hints: [{ t: 8, text: "Spread" }, { t: 2, text: "Stack north" }],
  }));
  expect(createWorld(raid).hints).toEqual([{ t: 2, text: "Stack north" }, { t: 8, text: "Spread" }]);
});

test("hints default to empty when omitted", () => {
  expect(createWorld(loadRaid(baseRaid)).hints).toEqual([]);
  expect(createWorld(applyBotPatterns(loadRaid(baseRaid), loadBotPatterns({ players: {} }))).hints).toEqual([]);
});

test("loadBotPatterns rejects malformed hints", () => {
  expect(() => loadBotPatterns({ players: {}, hints: [{ t: -1, text: "Early" }] })).toThrow();
  expect(() => loadBotPatterns({ players: {}, hints: [{ t: 1, text: "" }] })).toThrow();
});
