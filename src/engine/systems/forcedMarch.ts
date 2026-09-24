import type { TickContext } from "./context";
import type { ActiveForcedMarch, PendingForcedMarch } from "@model/types";
import { add, sub, normalize, scale, length } from "@shared/math";
import { applyStatus, requireStatus } from "@status";
import { statusServices } from "./statusServices";
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
      const entrant = players.find(p => p.alive && length(sub(p.pos, fm.pos)) <= fm.radius);
      if (entrant) {
        fm.triggered = true;
        fm.triggeredAt = time;
        fm.capturedPlayerId = entrant.id;
        fm.capturedFrom = { x: entrant.pos.x, z: entrant.pos.z };
        applyStatus(entrant, requireStatus("forced_march_hold", { name: fm.name, duration: fm.preDelay + fm.postDelay }), `${fm.id}-freeze`, statusServices(ctx));
      }
    } else if (fm.triggered && !fm.teleported && time >= fm.triggeredAt! + fm.preDelay) {
      const captured = players.find(p => p.id === fm.capturedPlayerId && p.alive);
      if (captured) {
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
