import type { Player } from "@shared/types";

export function resolvePovPlayer(
  players: Player[],
  localPlayerId: string | null,
  spectateTargetId: string | null,
): Player | undefined {
  const local = players.find(player => player.id === localPlayerId);
  if (local?.alive) return local;

  const selected = players.find(player => player.id === spectateTargetId);
  if (selected?.alive) return selected;

  return players.find(player => player.alive) ?? local ?? selected ?? players[0];
}
