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

test("an event hint is kept only when its event survives the pre-roll", async () => {
  const raid = loadRaid(Bun.YAML.parse(await Bun.file("raids/forked-tower-magic/omni-elements-1.yaml").text()));
  const bots = loadBotPatterns(Bun.YAML.parse(await Bun.file("raids/forked-tower-magic/omni-elements-1-bots.yaml").text()));
  const withHints = applyBotPatterns(raid, bots);
  for (const [option, text] of [[0, "Bow - get IN"], [1, "Harp - get OUT"]] as const) {
    const world = createWorld(withHints, 1, { "event-set-implement-1": option, "event-set-implement-2": option });
    expect(world.hints).toEqual([{ t: 31.5, text }, { t: 45.76, text }]);
  }
});

test("applyBotPatterns rejects a hint that references an unknown event", () => {
  expect(() => applyBotPatterns(loadRaid(baseRaid), loadBotPatterns({ players: {}, hints: [{ t: 1, text: "Go", event: "nope" }] }))).toThrow();
});
