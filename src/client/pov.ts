import type { LogEntry, Player } from "@model/types";

export const DEATH_HOLD_SECS = 2;

export function deathTimeOf(log: readonly LogEntry[], playerId: string, time: number): number | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i]!;
    if (entry.event === "death" && entry.playerId === playerId && entry.t <= time) return entry.t;
  }
  return undefined;
}

export function updateDeathTimes(deathTimes: Map<string, number>, players: Player[], log: readonly LogEntry[], time: number): void {
  for (const player of players) {
    if (player.alive) {
      deathTimes.delete(player.id);
      continue;
    }
    const known = deathTimes.get(player.id);
    if (known === undefined || known > time) deathTimes.set(player.id, deathTimeOf(log, player.id, time) ?? time);
  }
}

export function resolvePovPlayer(
  players: Player[],
  localPlayerId: string | null,
  spectateTargetId: string | null,
  deathTimes: ReadonlyMap<string, number>,
  time: number,
): Player | undefined {
  const holdsPov = (player: Player | undefined): boolean => {
    if (!player) return false;
    if (player.alive) return true;
    const diedAt = deathTimes.get(player.id);
    return diedAt !== undefined && time - diedAt < DEATH_HOLD_SECS;
  };

  const local = players.find(player => player.id === localPlayerId);
  if (holdsPov(local)) return local;

  const selected = players.find(player => player.id === spectateTargetId);
  if (holdsPov(selected)) return selected;

  return players.find(player => player.alive) ?? local ?? selected ?? players[0];
}
