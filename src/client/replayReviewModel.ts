// Presentation logic for the replay review UI, kept free of the DOM. ui/ReplayReview.ts renders it.

import type { ReplayEvent } from "@shared/replay";
import type { MechanicSection } from "@shared/types";

const TICKS_PER_SECOND = 60;
// Selecting a hit or death rewinds this far so the lead-up is visible, not just the aftermath.
const PREROLL_TICKS = 3 * TICKS_PER_SECOND;

export type ReplayFilter = "all" | "deaths" | "hits";

export type ReplayFilterState = {
  filter: ReplayFilter;
  playerId: string; // "" = every party member
  query: string;    // already lower-cased and trimmed
};

// A lethal avoidable hit is one moment, not two: its hit and death events merge into a single row
// that both the Deaths and Avoidable hits filters match.
export type ReviewRow = {
  id: string;
  tick: number;
  playerId: string;
  playerLabel: string;
  sourceName: string;
  sectionId?: string;
  isDeath: boolean;
  isHit: boolean;
  hpLoss?: number;
};

export function ticksToLabel(tick: number): string {
  const totalSeconds = Math.floor(tick / TICKS_PER_SECOND);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function buildRows(events: ReplayEvent[]): ReviewRow[] {
  const linkedHitIds = new Set(events.map(event => event.hitEventId).filter((id): id is string => id !== undefined));
  const hitById = new Map(events.filter(event => event.kind === "hit").map(event => [event.id, event]));
  const rows: ReviewRow[] = [];
  for (const event of events) {
    if (event.kind === "hit" && linkedHitIds.has(event.id)) continue; // merged into its death row
    const linkedHit = event.hitEventId !== undefined ? hitById.get(event.hitEventId) : undefined;
    rows.push({
      id: event.id,
      tick: event.tick,
      playerId: event.playerId,
      playerLabel: event.playerLabel,
      sourceName: event.sourceName,
      sectionId: event.sectionId,
      isDeath: event.kind === "death",
      isHit: event.kind === "hit" || linkedHit !== undefined,
      hpLoss: event.kind === "hit" ? event.hpLoss : linkedHit?.hpLoss,
    });
  }
  return rows;
}

export function matchesFilter(row: ReviewRow, state: ReplayFilterState, sectionNameById: Map<string, string>): boolean {
  if (state.filter === "deaths" && !row.isDeath) return false;
  if (state.filter === "hits" && !row.isHit) return false;
  if (state.playerId !== "" && row.playerId !== state.playerId) return false;
  if (state.query === "") return true;
  const section = row.sectionId !== undefined ? sectionNameById.get(row.sectionId) ?? "" : "";
  return `${row.playerLabel} ${row.sourceName} ${section}`.toLowerCase().includes(state.query);
}

export function rowLabel(row: ReviewRow): string {
  if (row.isDeath && row.isHit) return "Death · Avoidable hit";
  return row.isDeath ? "Death" : "Avoidable hit";
}

export function damageLabel(row: ReviewRow): string {
  if (row.hpLoss === undefined) return "";
  return row.hpLoss === 0 ? "0 damage — prevented" : `${Math.round(row.hpLoss)} damage`;
}

// Deaths at the same tick would stack into an unclickable pile on the seek bar, so they share one
// marker.
export function groupDeathMarkers(rows: ReviewRow[]): { tick: number; rows: ReviewRow[] }[] {
  const byTick = new Map<number, ReviewRow[]>();
  for (const row of rows) {
    if (!row.isDeath) continue;
    const group = byTick.get(row.tick);
    if (group) group.push(row); else byTick.set(row.tick, [row]);
  }
  return [...byTick].sort((a, b) => a[0] - b[0]).map(([tick, group]) => ({ tick, rows: group }));
}

export function eventSeekTick(tick: number): number {
  return Math.max(0, tick - PREROLL_TICKS);
}

// A section starts where it was authored to start — no pre-roll, unlike an event.
export function sectionSeekTick(section: MechanicSection, duration: number): number {
  return Math.max(0, Math.min(duration, Math.round(section.t * TICKS_PER_SECOND)));
}
