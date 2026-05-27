import type { ActiveMechanic, PendingEvent } from "../shared/types";

export function promotePending(
  pending: PendingEvent[],
  time: number
): { promoted: ActiveMechanic[]; remaining: PendingEvent[] } {
  const promoted: ActiveMechanic[] = [];
  const remaining: PendingEvent[] = [];

  for (const event of pending) {
    if (event.t <= time) {
      promoted.push({
        id: event.id,
        name: event.name,
        shape: event.shape,
        telegraphStart: event.t,
        resolveAt: event.t + event.telegraph,
        damage: event.damage,
        damageType: event.damageType,
        applyEffect: event.applyEffect,
        resolved: false,
        showCastBar: event.showCastBar,
      });
    } else {
      remaining.push(event);
    }
  }

  return { promoted, remaining };
}
