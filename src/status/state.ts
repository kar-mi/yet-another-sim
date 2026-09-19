import type { StatusActor, StatusInstance, StatusSource } from "./types";

export function isStatusActive(status: Pick<StatusInstance, "appliedAt" | "duration">, time: number): boolean {
  return status.appliedAt + status.duration > time;
}

export function expiresWithin(status: Pick<StatusInstance, "appliedAt" | "duration">, previousTime: number, time: number): boolean {
  const expiry = status.appliedAt + status.duration;
  return expiry > previousTime && expiry <= time;
}

export function activeDuring(status: Pick<StatusInstance, "appliedAt" | "duration">, previousTime: number, time: number): number {
  const start = Math.max(previousTime, status.appliedAt);
  const end = Math.min(time, status.appliedAt + status.duration);
  return Math.max(0, end - start);
}

export function statusSource(status: StatusInstance): StatusSource {
  return { key: status.id, name: status.name, avoidable: status.avoidable === true };
}

export function removeWhere(actor: StatusActor, predicate: (status: StatusInstance) => boolean): void {
  if (actor.effects.some(predicate)) actor.effects = actor.effects.filter(status => !predicate(status));
}

export function removeInstance(actor: StatusActor, status: StatusInstance): void {
  removeWhere(actor, candidate => candidate === status);
}

export function replaceInstance(actor: StatusActor, status: StatusInstance, next: StatusInstance): void {
  actor.effects = actor.effects.map(candidate => candidate === status ? next : candidate);
}
