import { describe, expect, test } from "bun:test";
import { createWorld } from "../../engine/world";
import { baseRaid, loadRaid } from "../../engine/__tests__/helpers";
import { DEATH_HOLD_SECS, resolvePovPlayer, updateDeathTimes } from "../pov";
import type { LogEntry } from "@model/types";

const death = (playerId: string, t: number) => ({ t, event: "death", playerId }) as LogEntry;

describe("POV player resolution", () => {
  test("keeps a living local player even when a spectate target is selected", () => {
    const players = createWorld(loadRaid(baseRaid)).players;

    expect(resolvePovPlayer(players, players[0]!.id, players[1]!.id, new Map(), 0)?.id).toBe(players[0]!.id);
  });

  test("uses the selected living player for an observer", () => {
    const players = createWorld(loadRaid(baseRaid)).players;

    expect(resolvePovPlayer(players, null, players[2]!.id, new Map(), 0)?.id).toBe(players[2]!.id);
  });

  test("uses the selected living player when the local player is dead", () => {
    const players = createWorld(loadRaid(baseRaid)).players;
    players[0]!.alive = false;

    expect(resolvePovPlayer(players, players[0]!.id, players[3]!.id, new Map(), 0)?.id).toBe(players[3]!.id);
  });

  test("falls back to the first living player when the selection is dead", () => {
    const players = createWorld(loadRaid(baseRaid)).players;
    players[2]!.alive = false;

    expect(resolvePovPlayer(players, null, players[2]!.id, new Map(), 0)?.id).toBe(players[0]!.id);
  });

  test("keeps a stable HUD subject when every player is dead", () => {
    const players = createWorld(loadRaid(baseRaid)).players;
    for (const player of players) player.alive = false;

    expect(resolvePovPlayer(players, null, players[2]!.id, new Map(), 0)?.id).toBe(players[2]!.id);
  });

  test("holds on the dead local player before switching to the spectate target", () => {
    const players = createWorld(loadRaid(baseRaid)).players;
    const deathTimes = new Map<string, number>();
    players[0]!.alive = false;
    updateDeathTimes(deathTimes, players, [], 10);

    expect(resolvePovPlayer(players, players[0]!.id, players[3]!.id, deathTimes, 11)?.id).toBe(players[0]!.id);
    expect(resolvePovPlayer(players, players[0]!.id, players[3]!.id, deathTimes, 10 + DEATH_HOLD_SECS)?.id).toBe(players[3]!.id);
  });

  test("holds on an observer's spectate target right after it dies", () => {
    const players = createWorld(loadRaid(baseRaid)).players;
    const deathTimes = new Map<string, number>();
    players[2]!.alive = false;
    updateDeathTimes(deathTimes, players, [], 10);
    updateDeathTimes(deathTimes, players, [], 11);

    expect(resolvePovPlayer(players, null, players[2]!.id, deathTimes, 11)?.id).toBe(players[2]!.id);
    expect(resolvePovPlayer(players, null, players[2]!.id, deathTimes, 12.5)?.id).toBe(players[0]!.id);
  });

  test("uses the logged death time when a replay seeks past a death", () => {
    const players = createWorld(loadRaid(baseRaid)).players;
    const deathTimes = new Map<string, number>();
    players[0]!.alive = false;
    updateDeathTimes(deathTimes, players, [death(players[0]!.id, 10)], 30);

    expect(resolvePovPlayer(players, players[0]!.id, players[3]!.id, deathTimes, 30)?.id).toBe(players[3]!.id);
  });

  test("forgets the death time when the player is alive again", () => {
    const players = createWorld(loadRaid(baseRaid)).players;
    const deathTimes = new Map<string, number>();
    players[0]!.alive = false;
    updateDeathTimes(deathTimes, players, [], 10);
    players[0]!.alive = true;
    updateDeathTimes(deathTimes, players, [], 5);

    expect(deathTimes.has(players[0]!.id)).toBe(false);
  });
});
