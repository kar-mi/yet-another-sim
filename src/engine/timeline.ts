import type { ActiveMechanic, AOEShape, Boss, PendingEvent } from "@shared/types";
import { sin, cos } from "@shared/dmath";

function bossForEvent(event: PendingEvent, bosses: Boss[]): Boss {
  const b = event.bossId ? bosses.find(b => b.id === event.bossId) : undefined;
  return b ?? bosses[0]!;
}

// Snapshot a boss-anchored cone/rect against the boss (FFXIV-style): origin from boss.pos,
// direction from boss.facing (0 = +Z, matching the sim convention). Used both at cast start
// (promotePending) and when a bait arms a deferred stored cleave from the boss's locked facing.
export function anchorShape(
  boss: Boss,
  shape: AOEShape,
  opts: { anchor?: "boss"; directionFrom?: "bossFacing"; directionOffset?: number },
): AOEShape {
  if (!opts.anchor && !opts.directionFrom) {
    return shape;
  }
  if (shape.kind === "circle") {
    return opts.anchor === "boss" ? { ...shape, center: { x: boss.pos.x, z: boss.pos.z } } : shape;
  }
  if (shape.kind === "donut") {
    return opts.anchor === "boss" ? { ...shape, center: { x: boss.pos.x, z: boss.pos.z } } : shape;
  }
  if (shape.kind !== "cone" && shape.kind !== "rect") return shape;
  const facing = boss.facing + (opts.directionOffset ?? 0);
  return {
    ...shape,
    origin: opts.anchor === "boss" ? { x: boss.pos.x, z: boss.pos.z } : shape.origin,
    direction: opts.directionFrom === "bossFacing"
      ? { x: sin(facing), z: cos(facing) }
      : shape.direction,
  };
}

function resolveAnchoredShape(event: PendingEvent, boss: Boss): AOEShape {
  return anchorShape(boss, event.shape, event);
}

export function promotePending(
  pending: PendingEvent[],
  time: number,
  bosses: Boss[],
): { promoted: ActiveMechanic[]; remaining: PendingEvent[] } {
  const promoted: ActiveMechanic[] = [];
  const remaining: PendingEvent[] = [];

  for (const event of pending) {
    if (event.t <= time) {
      const boss = bossForEvent(event, bosses);
      promoted.push({
        id: event.id,
        name: event.name,
        labels: event.labels,
        group: event.group,
        bossId: event.bossId,
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
        bossStationary: event.bossStationary,
        deferred: event.deferred,
        telegraphDuration: event.deferred ? event.telegraph : undefined,
        armed: false,
        requireFullHp: event.requireFullHp,
        anchor: event.anchor,
        directionFrom: event.directionFrom,
        directionOffset: event.directionOffset,
        resolved: false,
        showCastBar: event.showCastBar,
        showTelegraph: event.deferred ? false : event.showTelegraph,
        telegraphMode: event.telegraphMode,
        flashBeforeResolve: event.flashBeforeResolve,
      });
    } else {
      remaining.push(event);
    }
  }

  return { promoted, remaining };
}
