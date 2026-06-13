// Phase 1c: forced-march traps. Arm pending traps, capture the first living entrant, then run the
// freeze -> teleport -> freeze sequence. Runs after movement so it sees updated positions. The
// resulting array is stored on ctx.forcedMarches because the status-effect system later appends
// plant-spawned traps to it (those new traps are intentionally not culled until next tick).

import type { TickContext } from "./context";
import type { ActiveForcedMarch, PendingForcedMarch } from "@shared/types";
import { add, sub, normalize, scale, length } from "@shared/math";
import { applyEffect } from "./helpers";
import { FORCED_MARCH_LINGER } from "@shared/constants";
import { atan2 } from "@shared/dmath";

export function resolveForcedMarches(ctx: TickContext): PendingForcedMarch[] {
  const { players, log, time } = ctx;
  let forcedMarches: ActiveForcedMarch[] = ctx.world.forcedMarches.map(fm => ({ ...fm }));
  for (const pfm of ctx.world.pendingForcedMarches) {
    if (pfm.t <= time) {
      forcedMarches.push({
        id: pfm.id, name: pfm.name, pos: pfm.pos, radius: pfm.radius,
        direction: pfm.direction, distance: pfm.distance,
        preDelay: pfm.preDelay, postDelay: pfm.postDelay, relativeMove: false,
        armedAt: pfm.t, expireAt: pfm.t + pfm.duration, triggered: false, teleported: false,
      });
    }
  }
  const remaining = ctx.world.pendingForcedMarches.filter(pfm => pfm.t > time);
  for (const fm of forcedMarches) {
    if (!fm.triggered && time >= fm.armedAt) {
      // First living player (in roster order) inside the zone is captured and frozen in place.
      const entrant = players.find(p => p.alive && length(sub(p.pos, fm.pos)) <= fm.radius);
      if (entrant) {
        fm.triggered = true;
        fm.triggeredAt = time;
        fm.capturedPlayerId = entrant.id;
        fm.capturedFrom = { x: entrant.pos.x, z: entrant.pos.z };
        // A transient sleep effect holds them still for the windup + recovery window.
        applyEffect(entrant, {
          name: fm.name, kind: "debuff",
          duration: fm.preDelay + fm.postDelay,
          behavior: { kind: "sleep" },
        }, time, `${fm.id}-freeze`, players);
      }
    } else if (!fm.teleported && time >= (fm.triggeredAt ?? time) + fm.preDelay) {
      // windup (preDelay) elapsed: instantly teleport the captured player to the destination.
      const captured = players.find(p => p.id === fm.capturedPlayerId && p.alive);
      if (captured) {
        // forced_march anchors the destination to the trap center; the plant trap teleports the
        // captured player `distance` from their own spot so it lands purely along `direction`.
        const anchor = fm.relativeMove ? (fm.capturedFrom ?? fm.pos) : fm.pos;
        captured.pos = add(anchor, scale(normalize(fm.direction), fm.distance));
        captured.botWaypointResumeAfter = time;
        captured.facing = atan2(fm.direction.x, fm.direction.z);
        log.push({ t: time, mechanic: fm.name, playerId: captured.id, event: "hit" });
      }
      fm.teleported = true;
    }
  }
  forcedMarches = forcedMarches.filter(fm =>
    fm.triggered
      ? time <= (fm.triggeredAt ?? time) + fm.preDelay + fm.postDelay + FORCED_MARCH_LINGER
      : fm.expireAt > time);
  ctx.forcedMarches = forcedMarches;
  return remaining;
}
