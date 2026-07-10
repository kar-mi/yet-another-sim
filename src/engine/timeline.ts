import type { ActiveMechanic, AOEShape, Boss, PendingEvent, Player } from "@shared/types";
import { sin, cos } from "@shared/dmath";
import { normalize, scale, add, sub } from "@shared/math";
import { buildFloorAoe } from "./floorAoeBuild";

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

function shapeAimOrigin(shape: AOEShape) {
  if (shape.kind === "cone" || shape.kind === "rect") return shape.origin;
  return undefined;
}

function resolveAnchoredShape(event: PendingEvent, boss: Boss, players: Player[]): AOEShape {
  if (event.bossRelativeCenter && (event.shape.kind === "circle" || event.shape.kind === "donut")) {
    const forward = normalize({ x: -boss.pos.x, z: -boss.pos.z });
    const relativeNorth = forward.x === 0 && forward.z === 0 ? { x: 0, z: -1 } : forward;
    const right = { x: relativeNorth.z, z: -relativeNorth.x };
    const center = add(scale(right, event.bossRelativeCenter.lateral), scale(relativeNorth, event.bossRelativeCenter.forward));
    return { ...event.shape, center };
  }
  const shape = anchorShape(boss, event.shape, event);
  if (event.aimAtPlayer && (shape.kind === "cone" || shape.kind === "rect")) {
    const target = players.find(player => player.id === event.aimAtPlayer && player.alive);
    const origin = shapeAimOrigin(shape);
    if (target && origin) return { ...shape, direction: normalize(sub(target.pos, origin)) };
  }
  return shape;
}

export function promotePending(
  pending: PendingEvent[],
  time: number,
  bosses: Boss[],
  players: Player[],
): { promoted: ActiveMechanic[]; remaining: PendingEvent[] } {
  const promoted: ActiveMechanic[] = [];
  const remaining: PendingEvent[] = [];

  for (const event of pending) {
    if (event.t <= time) {
      const boss = bossForEvent(event, bosses);
      // Deferred (stored) cleaves don't snapshot geometry now; a linked bait recomputes it from the
      // boss's locked facing at arm time, so keep the raw shape as a hidden placeholder until then.
      const shape = event.deferred ? event.shape : resolveAnchoredShape(event, boss, players);
      const resolveAt = event.t + event.telegraph;
      const showTelegraph = event.deferred ? false : event.showTelegraph;
      promoted.push({
        id: event.id,
        name: event.name,
        labels: event.labels,
        group: event.group,
        bossId: event.bossId,
        shape,
        telegraphStart: event.t,
        resolveAt,
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
        showTelegraph,
        telegraphMode: event.telegraphMode,
        flashBeforeResolve: event.flashBeforeResolve,
        color: event.color,
        floorAoe: event.deferred ? undefined : buildFloorAoe({
          id: event.id, shape, color: event.color, showTelegraph,
          telegraphMode: event.telegraphMode, flashBeforeResolve: event.flashBeforeResolve, resolveAt,
        }),
      });
    } else {
      remaining.push(event);
    }
  }

  return { promoted, remaining };
}
