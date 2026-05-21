import type { World } from "../shared/types";

export type MechanicSummary = {
  name: string;
  hits: { playerId: string; t: number }[];
  clears: { playerId: string; t: number }[];
};

export type SimResult = {
  status: "cleared" | "wiped" | "running";
  survivingPlayers: string[];
  mechanics: MechanicSummary[];
};

export function getResult(world: World): SimResult {
  const survivingPlayers = world.players.filter(p => p.alive).map(p => p.id);

  const mechanicMap = new Map<string, MechanicSummary>();
  for (const entry of world.log) {
    if (entry.event === "fell") continue;
    if (!mechanicMap.has(entry.mechanic)) {
      mechanicMap.set(entry.mechanic, { name: entry.mechanic, hits: [], clears: [] });
    }
    const m = mechanicMap.get(entry.mechanic)!;
    if (entry.event === "hit") {
      m.hits.push({ playerId: entry.playerId, t: entry.t });
    } else {
      m.clears.push({ playerId: entry.playerId, t: entry.t });
    }
  }

  return {
    status: world.status,
    survivingPlayers,
    mechanics: Array.from(mechanicMap.values()),
  };
}
