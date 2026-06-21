import type { ActiveDivebomb, PendingDivebomb } from "@shared/types";
import { DIVEBOMB_LINGER } from "@shared/constants";
import { length, sub } from "@shared/math";
import { divebombLifetime, divebombPosition } from "@shared/divebomb";
import type { TickContext } from "./context";
import { applyEffect, applyMechanicDamage } from "./helpers";

export function resolveDivebombs(ctx: TickContext): {
  divebombs: ActiveDivebomb[];
  pendingDivebombs: PendingDivebomb[];
} {
  const { players, log, time } = ctx;
  const pendingDivebombs: PendingDivebomb[] = [];
  const divebombs = ctx.world.divebombs.map(db => ({ ...db, hits: { ...db.hits } }));

  for (const pending of ctx.world.pendingDivebombs) {
    if (pending.t <= time) {
      const { t, ...fields } = pending;
      divebombs.push({
        ...fields,
        startedAt: t,
        expireAt: t + divebombLifetime(pending.from, pending.to, pending.gap, pending.speed),
        resolved: false,
        hits: {},
      });
    } else {
      pendingDivebombs.push(pending);
    }
  }

  for (const divebomb of divebombs) {
    if (divebomb.resolved) continue;
    if (time >= divebomb.expireAt) {
      divebomb.resolved = true;
      continue;
    }

    const center = divebombPosition(
      divebomb.from,
      divebomb.to,
      divebomb.gap,
      divebomb.speed,
      time - divebomb.startedAt,
    );
    for (const player of players) {
      if (!player.alive) continue;
      if (length(sub(player.pos, center)) > divebomb.size / 2) continue;

      const lastHit = divebomb.hits[player.id] ?? Number.NEGATIVE_INFINITY;
      if (time - lastHit < divebomb.hitInterval) continue;

      let applied = false;
      if ((divebomb.damage ?? 0) > 0) {
        applyMechanicDamage(player, divebomb.damage!, divebomb.damageType, time);
        applied = true;
      }
      if (divebomb.applyEffect && player.alive) {
        applyEffect(player, divebomb.applyEffect, time, `${divebomb.id}-${player.id}-${time}-eff`, players);
        applied = true;
      }
      if (applied) {
        divebomb.hits[player.id] = time;
        log.push({ t: time, mechanic: divebomb.name, playerId: player.id, event: "hit" });
      }
    }
  }

  return {
    pendingDivebombs,
    divebombs: divebombs.filter(db => !db.resolved || db.expireAt >= time - DIVEBOMB_LINGER),
  };
}
