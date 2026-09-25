import { expect, test } from "bun:test";
import { dueHints, systemText } from "../chatModel";

const hints = [{ t: 0, text: "Opener" }, { t: 5, text: "Stack" }, { t: 10, text: "Spread" }];

test("dueHints returns hints crossed since the previous time, inclusive of the current time", () => {
  expect(dueHints(hints, -1, 0).map(hint => hint.text)).toEqual(["Opener"]);
  expect(dueHints(hints, 0, 4.99)).toEqual([]);
  expect(dueHints(hints, 4.99, 5).map(hint => hint.text)).toEqual(["Stack"]);
  expect(dueHints(hints, 5, 5)).toEqual([]);
  expect(dueHints(hints, 5, 20).map(hint => hint.text)).toEqual(["Spread"]);
});

test("systemText words host changes for the viewer", () => {
  expect(systemText({ kind: "hostChanged", hostParticipantId: "me" }, "me")).toBe("You are now the host");
  expect(systemText({ kind: "hostChanged", hostParticipantId: "other" }, "me")).toBe("The host changed");
  expect(systemText({ kind: "slotClaimed", playerId: "m1" }, "me")).toBe("M1 was claimed");
});
