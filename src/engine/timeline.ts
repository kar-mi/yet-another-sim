import type { ActiveMechanic, AOEShape, Boss, PendingEvent } from "../shared/types";

// Snapshot a boss-anchored cone/rect against the boss (FFXIV-style): origin from boss.pos,
// direction from boss.facing (0 = +Z, matching the sim convention). Used both at cast start
// (promotePending) and when a bait arms a deferred stored cleave from the boss's locked facing.
export function anchorShape(
  boss: Boss,
  shape: AOEShape,
  opts: { anchor?: "boss"; directionFrom?: "bossFacing"; directionOffset?: number },
): AOEShape {
  if ((!opts.anchor && !opts.directionFrom) || (shape.kind !== "cone" && shape.kind !== "rect")) {
    return shape;
  }
  const facing = boss.facing + (opts.directionOffset ?? 0);
  return {
    ...shape,
    origin: opts.anchor === "boss" ? { x: boss.pos.x, z: boss.pos.z } : shape.origin,
    direction: opts.directionFrom === "bossFacing"
      ? { x: Math.sin(facing), z: Math.cos(facing) }
      : shape.direction,
  };
}

function resolveAnchoredShape(event: PendingEvent, boss: Boss): AOEShape {
  return anchorShape(boss, event.shape, event);
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
        // Deferred (stored) cleaves don't snapshot geometry now; a linked bait recomputes it from the
        // boss's locked facing at arm time, so keep the raw shape as a hidden placeholder until then.
        shape: event.deferred ? event.shape : resolveAnchoredShape(event, boss),
        telegraphStart: event.t,
        resolveAt: event.t + event.telegraph,
        damage: event.damage,
        damageType: event.damageType,
        applyEffect: event.applyEffect,
        applyEffects: event.applyEffects,
        knockback: event.knockback,
        positional: event.positional,
        // A deferred cleave must NOT lock facing (the boss has to stay free to turn to the bait) and
        // stays hidden + unarmed until its linked bait arms it.
        lockFacing: event.deferred ? false : event.lockFacing,
        deferred: event.deferred,
        armed: false,
        anchor: event.anchor,
        directionFrom: event.directionFrom,
        directionOffset: event.directionOffset,
        resolved: false,
        showCastBar: event.showCastBar,
        showTelegraph: event.deferred ? false : event.showTelegraph,
      });
    } else {
      remaining.push(event);
    }
  }

  return { promoted, remaining };
}
