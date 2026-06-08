import type { ActiveMechanic, AOEShape, Boss, PendingEvent } from "../shared/types";

// Snapshot a boss-anchored cone/rect against the boss at cast start (FFXIV-style):
// origin from boss.pos, direction from boss.facing (0 = +Z, matching the sim convention).
function resolveAnchoredShape(event: PendingEvent, boss: Boss): AOEShape {
  const shape = event.shape;
  if ((!event.anchor && !event.directionFrom) || (shape.kind !== "cone" && shape.kind !== "rect")) {
    return shape;
  }
  const facing = boss.facing + (event.directionOffset ?? 0);
  return {
    ...shape,
    origin: event.anchor === "boss" ? { x: boss.pos.x, z: boss.pos.z } : shape.origin,
    direction: event.directionFrom === "bossFacing"
      ? { x: Math.sin(facing), z: Math.cos(facing) }
      : shape.direction,
  };
}

export function promotePending(
  pending: PendingEvent[],
  time: number,
  boss: Boss
): { promoted: ActiveMechanic[]; remaining: PendingEvent[] } {
  const promoted: ActiveMechanic[] = [];
  const remaining: PendingEvent[] = [];

  for (const event of pending) {
    if (event.t <= time) {
      promoted.push({
        id: event.id,
        name: event.name,
        shape: resolveAnchoredShape(event, boss),
        telegraphStart: event.t,
        resolveAt: event.t + event.telegraph,
        damage: event.damage,
        damageType: event.damageType,
        applyEffect: event.applyEffect,
        applyEffects: event.applyEffects,
        knockback: event.knockback,
        positional: event.positional,
        lockFacing: event.lockFacing,
        resolved: false,
        showCastBar: event.showCastBar,
        showTelegraph: event.showTelegraph,
      });
    } else {
      remaining.push(event);
    }
  }

  return { promoted, remaining };
}
