import type { PendingEffectCheck } from "@shared/types";
import type { TickContext } from "./context";
import { applyMechanicDamage, isEffectActiveAt } from "./helpers";

export function resolveEffectChecks(ctx: TickContext): PendingEffectCheck[] {
  const remaining: PendingEffectCheck[] = [];
  for (const check of ctx.world.pendingEffectChecks) {
    if (check.t > ctx.time) { remaining.push(check); continue; }
    for (const rule of check.checks) for (const player of ctx.players) {
      if (!player.alive || !player.effects.some(e => e.name === rule.carriers && isEffectActiveAt(e, ctx.time))) continue;
      const [left, right] = rule.compare.map(group => player.effects.find(e => e.group === group && isEffectActiveAt(e, ctx.time))?.name);
      const passes = left !== undefined && right !== undefined
        && (rule.expect === "matches" ? left === right : left !== right);
      if (!passes) {
        applyMechanicDamage(player, check.failureDamage, check.failureDamageType, ctx.time);
        ctx.log.push({ t: ctx.time, mechanic: check.name, playerId: player.id, event: "hit" });
      } else ctx.log.push({ t: ctx.time, mechanic: check.name, playerId: player.id, event: "cleared" });
    }
  }
  return remaining;
}
