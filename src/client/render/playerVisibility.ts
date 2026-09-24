import type { Player } from "@model/types";

type VisibilityPlayer = Pick<Player, "id" | "control" | "pos" | "y" | "alive">;
const MODEL_OVERLAP_DISTANCE = 0.05;

function prefer(candidate: VisibilityPlayer, current: VisibilityPlayer): boolean {
  if (candidate.alive !== current.alive) return candidate.alive;
  return candidate.control === "human" && current.control !== "human";
}

function overlaps(a: VisibilityPlayer, b: VisibilityPlayer): boolean {
  const dx = a.pos.x - b.pos.x;
  const dy = a.y - b.y;
  const dz = a.pos.z - b.pos.z;
  return dx * dx + dy * dy + dz * dz <= MODEL_OVERLAP_DISTANCE * MODEL_OVERLAP_DISTANCE;
}

export function computeVisiblePlayerIds(players: VisibilityPlayer[]): Set<string> {
  const groups: Array<{ anchor: VisibilityPlayer; representative: VisibilityPlayer }> = [];
  for (const player of players) {
    const group = groups.find(entry => overlaps(player, entry.anchor));
    if (!group) groups.push({ anchor: player, representative: player });
    else if (prefer(player, group.representative)) group.representative = player;
  }
  return new Set(groups.map(group => group.representative.id));
}
