import { expect, test } from "bun:test";
import { computeVisiblePlayerIds } from "../render/playerVisibility";

const player = (id: string, control: "bot" | "human", x = 0, z = 0, alive = true) => ({
  id,
  control,
  pos: { x, z },
  y: 0,
  alive,
});

test("only one coincident bot model is visible", () => {
  const visible = computeVisiblePlayerIds([player("mt", "bot"), player("ot", "bot")]);

  expect(visible).toEqual(new Set(["mt"]));
});

test("only one model is visible when several bots stop around the same target", () => {
  const visible = computeVisiblePlayerIds([
    player("mt", "bot", -0.015, -0.015),
    player("ot", "bot", 0.015, -0.015),
    player("h1", "bot", -0.015, 0.015),
    player("h2", "bot", 0.015, 0.015),
  ]);

  expect(visible).toEqual(new Set(["mt"]));
});

test("a coincident human is shown instead of a bot", () => {
  const visible = computeVisiblePlayerIds([
    player("mt", "bot", 3, 4),
    player("local", "human", 3, 4),
  ]);

  expect(visible).toEqual(new Set(["local"]));
});

test("a living player is shown instead of a coincident dead player", () => {
  const visible = computeVisiblePlayerIds([
    player("local", "human", 3, 4, false),
    player("mt", "bot", 3, 4),
  ]);

  expect(visible).toEqual(new Set(["mt"]));
});

test("separate player models remain visible", () => {
  const visible = computeVisiblePlayerIds([
    player("mt", "bot", 1, 2),
    player("ot", "bot", 2, 3),
  ]);

  expect(visible).toEqual(new Set(["mt", "ot"]));
});

test("nearby players are not collapsed or moved", () => {
  const players = [player("mt", "bot"), player("ot", "bot", 0.051, 0)];
  const before = players.map(entry => ({ ...entry.pos }));

  expect(computeVisiblePlayerIds(players)).toEqual(new Set(["mt", "ot"]));
  expect(players.map(entry => entry.pos)).toEqual(before);
});
