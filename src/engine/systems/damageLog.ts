// Replay-review recording: avoidable hits and deaths.
//
// Entries go into the world's render-only `log` (excluded from worldHash, drained every tick), so
// recording adds no simulated state and cannot desync a pull.
//
// Classification comes from two places, both of which travel inside a recording: `avoidableSources`
// for mechanic damage, and the effect's own `avoidable` flag for status damage.

import type { LogEntry, Player, StatusEffect } from "@shared/types";

// The slice of TickContext the damage helpers need. TickContext satisfies it structurally.
export type DamageContext = {
  readonly time: number;
  log: LogEntry[];
  readonly avoidableSources: Record<string, true>;
};

export type DamageSource = { key: string; name: string; avoidable: boolean };

// Falling off the arena kills outside the damage pipeline, so it never produces a hit.
export const FALL_SOURCE: DamageSource = { key: "arena", name: "Arena", avoidable: false };

// A source key is the event id alone, or the id plus a slot for events that mix independently
// taggable sources. Must match the keys built in engine/avoidableSources.ts.
export function mechanicSource(dc: DamageContext, eventId: string, name: string, slot?: string): DamageSource {
  const key = slot === undefined ? eventId : `${eventId}:${slot}`;
  return { key, name, avoidable: dc.avoidableSources[key] === true };
}

export function effectSource(effect: StatusEffect): DamageSource {
  return { key: effect.id, name: effect.name, avoidable: effect.avoidable === true };
}

// Recorded before invincibility or mitigation suppresses the damage, so `hpLoss` may be 0.
export function recordAvoidableHit(dc: DamageContext, player: Player, source: DamageSource, hpLoss: number): void {
  if (!source.avoidable) return;
  dc.log.push({
    t: dc.time,
    mechanic: source.name,
    playerId: player.id,
    event: "avoidableHit",
    source: source.key,
    hpLoss,
  });
}

// Every alive-to-dead transition is recorded, tagged or not.
export function recordDeath(dc: DamageContext, player: Player, source: DamageSource): void {
  dc.log.push({
    t: dc.time,
    mechanic: source.name,
    playerId: player.id,
    event: "death",
    source: source.key,
  });
}
