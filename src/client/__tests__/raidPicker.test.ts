import { expect, test } from "bun:test";
import type { RaidCategory } from "@model/protocol";
import { EMPTY_RAID_ID } from "@model/protocol";
import { UNSELECTED_LABEL, categoryForRaidId, raidLabelForId } from "../ui/RaidPicker";

const CATEGORIES: RaidCategory[] = [
  { id: "dancing-mad-ultimate", name: "Dancing Mad Ultimate", description: "", raids: [{ id: "dancing-mad-ultimate/black-hole", name: "Black Hole" }] },
  { id: "debug", name: "Debug", description: "", raids: [{ id: "debug/chain-test", name: "Chain Test" }] },
];

test("a raid id opens on its own category", () => {
  expect(categoryForRaidId(CATEGORIES, "debug/chain-test")?.id).toBe("debug");
  expect(raidLabelForId(CATEGORIES, "debug/chain-test")).toBe("Chain Test");
});

test("nothing selected falls back to the first category, not an invented one", () => {
  expect(categoryForRaidId(CATEGORIES, EMPTY_RAID_ID)?.id).toBe("dancing-mad-ultimate");
  expect(categoryForRaidId(CATEGORIES, "no-such-category/raid")?.id).toBe("dancing-mad-ultimate");
});

test("the browser never offers a placeholder as a raid", () => {
  const offered = CATEGORIES.flatMap(category => category.raids.map(raid => raid.id));
  expect(offered).not.toContain(EMPTY_RAID_ID);
  expect(offered.some(id => raidLabelForId(CATEGORIES, id) === UNSELECTED_LABEL)).toBe(false);
});

test("an unselected or unknown raid id reads as the placeholder on the button", () => {
  expect(raidLabelForId(CATEGORIES, EMPTY_RAID_ID)).toBe(UNSELECTED_LABEL);
  expect(raidLabelForId(CATEGORIES, "debug/does-not-exist")).toBe(UNSELECTED_LABEL);
});

test("an empty catalog has no category to open", () => {
  expect(categoryForRaidId([], "debug/chain-test")).toBeNull();
  expect(raidLabelForId([], "debug/chain-test")).toBe(UNSELECTED_LABEL);
});
