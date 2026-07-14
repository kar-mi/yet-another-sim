import { describe, expect, test } from "bun:test";
import { createWorld } from "../../engine/world";
import { baseRaid, loadRaid } from "../../engine/__tests__/helpers";
import { resolvePovPlayer } from "../pov";

describe("POV player resolution", () => {
  test("keeps a living local player even when a spectate target is selected", () => {
    const players = createWorld(loadRaid(baseRaid)).players;

    expect(resolvePovPlayer(players, players[0]!.id, players[1]!.id)?.id).toBe(players[0]!.id);
  });

  test("uses the selected living player for an observer", () => {
    const players = createWorld(loadRaid(baseRaid)).players;

    expect(resolvePovPlayer(players, null, players[2]!.id)?.id).toBe(players[2]!.id);
  });

  test("uses the selected living player when the local player is dead", () => {
    const players = createWorld(loadRaid(baseRaid)).players;
    players[0]!.alive = false;

    expect(resolvePovPlayer(players, players[0]!.id, players[3]!.id)?.id).toBe(players[3]!.id);
  });

  test("falls back to the first living player when the selection is dead", () => {
    const players = createWorld(loadRaid(baseRaid)).players;
    players[2]!.alive = false;

    expect(resolvePovPlayer(players, null, players[2]!.id)?.id).toBe(players[0]!.id);
  });

  test("keeps a stable HUD subject when every player is dead", () => {
    const players = createWorld(loadRaid(baseRaid)).players;
    for (const player of players) player.alive = false;

    expect(resolvePovPlayer(players, null, players[2]!.id)?.id).toBe(players[2]!.id);
  });
});
