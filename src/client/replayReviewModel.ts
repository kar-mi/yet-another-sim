import type { ReplayEvent } from "@model/replay";
import type { MechanicSection } from "@model/types";

const TICKS_PER_SECOND = 60;
const PREROLL_TICKS = 0.5 * TICKS_PER_SECOND;

export type ReplayFilter = "all" | "deaths" | "hits";

export type ReplayFilterState = {
  filter: ReplayFilter;
  playerId: string;
  query: string;
};

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
    if (event.kind === "hit" && linkedHitIds.has(event.id)) continue;
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

export function eventSeekTick(tick: number): number {
  return Math.max(0, tick - PREROLL_TICKS);
}

export function sectionSeekTick(section: MechanicSection, duration: number): number {
  return Math.max(0, Math.min(duration, Math.round(section.t * TICKS_PER_SECOND)));
}
