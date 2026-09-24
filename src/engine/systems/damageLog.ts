import type { LogEntry, Player } from "@model/types";


export type DamageContext = {
  readonly time: number;
  log: LogEntry[];
  readonly avoidableSources: Record<string, true>;
};

export type DamageSource = { key: string; name: string; avoidable: boolean };

export const FALL_SOURCE: DamageSource = {
  key: "arena",
  name: "Arena",
  avoidable: false,
};

export function mechanicSource(
  dc: DamageContext,
  eventId: string,
  name: string,
  slot?: string,
): DamageSource {
  const key = slot === undefined ? eventId : `${eventId}:${slot}`;

  return { key, name, avoidable: dc.avoidableSources[key] === true };
}

export function recordAvoidableHit(
  dc: DamageContext,
  player: Player,
  source: DamageSource,
  hpLoss: number,
): void {
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

export function recordDeath(
  dc: DamageContext,
  player: Player,
  source: DamageSource,
): void {
  dc.log.push({
    t: dc.time,
    mechanic: source.name,
    playerId: player.id,
    event: "death",
    source: source.key,
  });
}
