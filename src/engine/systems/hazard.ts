import type { TickContext } from "./context";
import type { ActiveHazard, PendingHazard } from "@shared/types";
import { length, sub } from "@shared/math";
import { applyEffect } from "./helpers";

export function resolveHazards(ctx: TickContext): {
  hazards: ActiveHazard[];
  pendingHazards: PendingHazard[];
} {
  const { players, log, time } = ctx;
  const pendingHazards: PendingHazard[] = [];
  const hazards: ActiveHazard[] = ctx.world.hazards
    .filter(hazard => hazard.expireAt > time)
    .map(hazard => ({ ...hazard }));

  for (const pending of ctx.world.pendingHazards) {
    if (pending.t <= time) {
      hazards.push({
        id: pending.id,
        name: pending.name,
        spots: pending.spots,
        radius: pending.radius,
        spawnedAt: time,
        armingTime: pending.armingTime,
        expireAt: time + pending.duration,
        applyEffect: pending.applyEffect,
      });
    } else {
      pendingHazards.push(pending);
    }
  }

  for (const hazard of hazards) {
    if (time < hazard.spawnedAt + hazard.armingTime) continue;

    for (const player of players) {
      if (!player.alive) continue;
      if (!hazard.spots.some(spot => length(sub(player.pos, spot)) <= hazard.radius)) continue;

      const id = `${hazard.id}-${player.id}`;
      const idx = player.effects.findIndex(effect => effect.id === id);
      if (idx >= 0) {
        player.effects = player.effects.map((effect, i) => i === idx ? { ...effect, appliedAt: time } : effect);
      } else {
        applyEffect(player, hazard.applyEffect, time, id, players);
        log.push({ t: time, mechanic: hazard.name, playerId: player.id, event: "hit" });
      }
    }
  }

  return { hazards, pendingHazards };
}
