import { expect, test } from "bun:test";
import type { ReplayEvent } from "@shared/replay";
import {
  buildRows, damageLabel, eventSeekTick, matchesFilter, rowLabel, sectionSeekTick, ticksToLabel,
  type ReplayFilterState,
} from "../replayReviewModel";

function event(over: Partial<ReplayEvent> & Pick<ReplayEvent, "id" | "kind">): ReplayEvent {
  return {
    tick: 600,
    playerId: "m1",
    playerLabel: "m1",
    sourceId: "boom",
    sourceName: "Boom",
    ...over,
  };
}

const NO_SECTIONS = new Map<string, string>();
const filters = (over: Partial<ReplayFilterState> = {}): ReplayFilterState =>
  ({ filter: "all", playerId: "", query: "", ...over });

test("a lethal avoidable hit becomes one row matching both filters", () => {
  const rows = buildRows([
    event({ id: "h1", kind: "hit", hpLoss: 500 }),
    event({ id: "d1", kind: "death", hitEventId: "h1" }),
  ]);

  expect(rows).toHaveLength(1);
  expect(rows[0]!.id).toBe("d1");
  expect(rowLabel(rows[0]!)).toBe("Death · Avoidable hit");
  expect(rows[0]!.hpLoss).toBe(500);
  expect(matchesFilter(rows[0]!, filters({ filter: "deaths" }), NO_SECTIONS)).toBe(true);
  expect(matchesFilter(rows[0]!, filters({ filter: "hits" }), NO_SECTIONS)).toBe(true);
});

test("an unlinked hit and an unlinked death stay separate rows with their own labels", () => {
  const rows = buildRows([
    event({ id: "h1", kind: "hit", hpLoss: 10 }),
    event({ id: "d1", kind: "death", sourceId: "arena", sourceName: "Arena" }),
  ]);

  expect(rows.map(rowLabel)).toEqual(["Avoidable hit", "Death"]);
  expect(matchesFilter(rows[0]!, filters({ filter: "deaths" }), NO_SECTIONS)).toBe(false);
  expect(matchesFilter(rows[1]!, filters({ filter: "hits" }), NO_SECTIONS)).toBe(false);
});

test("search, player and type filters combine", () => {
  const sections = new Map([["adds", "Add Phase"]]);
  const rows = buildRows([
    event({ id: "a", kind: "hit", playerId: "m1", playerLabel: "m1", sourceName: "Blizzard", sectionId: "adds", hpLoss: 5 }),
    event({ id: "b", kind: "hit", playerId: "h1", playerLabel: "h1", sourceName: "Blizzard", sectionId: "adds", hpLoss: 5 }),
    event({ id: "c", kind: "death", playerId: "m1", playerLabel: "m1", sourceName: "Meteor" }),
  ]);

  const matching = (state: Partial<ReplayFilterState>) =>
    rows.filter(row => matchesFilter(row, filters(state), sections)).map(row => row.id);

  expect(matching({ playerId: "m1" })).toEqual(["a", "c"]);
  expect(matching({ playerId: "m1", filter: "deaths" })).toEqual(["c"]);
  expect(matching({ query: "blizzard" })).toEqual(["a", "b"]);
  expect(matching({ query: "blizzard", playerId: "h1" })).toEqual(["b"]);
  // Search covers section names, not just player and source.
  expect(matching({ query: "add phase" })).toEqual(["a", "b"]);
  expect(matching({ query: "add phase", filter: "deaths" })).toEqual([]);
});

test("selecting an event seeks half a second earlier, clamped to the replay start", () => {
  expect(eventSeekTick(600)).toBe(570);
  expect(eventSeekTick(30)).toBe(0);
  expect(eventSeekTick(10)).toBe(0);
});

test("selecting a section seeks to its authored start, clamped to the replay", () => {
  expect(sectionSeekTick({ id: "s", name: "S", t: 12 }, 5000)).toBe(720);
  expect(sectionSeekTick({ id: "s", name: "S", t: 0 }, 5000)).toBe(0);
  expect(sectionSeekTick({ id: "s", name: "S", t: 999 }, 5000)).toBe(5000);
});

test("a fully prevented hit is labelled as prevented, not as zero damage", () => {
  const [prevented, real] = buildRows([
    event({ id: "a", kind: "hit", hpLoss: 0 }),
    event({ id: "b", kind: "hit", hpLoss: 12.4 }),
  ]);
  expect(damageLabel(prevented!)).toBe("0 damage — prevented");
  expect(damageLabel(real!)).toBe("12 damage");
  expect(damageLabel(buildRows([event({ id: "d", kind: "death" })])[0]!)).toBe("");
});

test("timestamps render as mm:ss", () => {
  expect(ticksToLabel(0)).toBe("00:00");
  expect(ticksToLabel(90)).toBe("00:01");
  expect(ticksToLabel(60 * 75)).toBe("01:15");
});
