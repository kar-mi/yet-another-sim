import type { Player } from "@shared/types";
import type { StatusServices } from "@status";
import type { TickContext } from "./context";
import { addResolvedAoeVisual } from "./effectResolvers";
import { applyKnockback, applyMechanicDamage, isLookingAt, launchAirtime, selectTargetPlayers } from "./helpers";
import { recordDeath } from "./damageLog";
import { hitPlayersInShape, resolveStackShare } from "./strikes";

const PLANT_TRAP_RECOVERY = 0.3;
const servicesByTick = new WeakMap<TickContext, StatusServices<Player>>();

export function statusServices(ctx: TickContext): StatusServices<Player> {
  let services = servicesByTick.get(ctx);
  if (!services) {
    services = createStatusServices(ctx);
    servicesByTick.set(ctx, services);
  }
  return services;
}

function createStatusServices(ctx: TickContext): StatusServices<Player> {
  return {
    get time() { return ctx.time; },
    get previousTime() { return ctx.previousTime; },
    get actors() { return ctx.players; },
    damage: (target, amount, damageType, source) => applyMechanicDamage(ctx, target, amount, damageType, source),
    log: (mechanic, playerId, event) => { ctx.log.push({ t: ctx.time, mechanic, playerId, event }); },
    recordDeath: (player, source) => recordDeath(ctx, player, source),
    randFloat: () => ctx.randFloat(),
    hitShape: (shape, damage, damageType, source, knockback) => hitPlayersInShape(ctx, shape, damage, damageType, source, { knockback }),
    resolveStack: (shape, stack, damageType, source) => resolveStackShare(ctx, shape, stack, damageType, source),
    selectTargets: (origin, mode, count, excludeId) => selectTargetPlayers(
      ctx.players.filter(player => player.alive && player.id !== excludeId), origin, mode, count),
    showAoe: (id, name, shape) => addResolvedAoeVisual(ctx, id, name, shape),
    isLookingAt: (player, target, halfAngle) => isLookingAt(player.facing, player.pos, target, halfAngle),
    launch: (player, height) => {
      applyKnockback(player, { distance: 0.001, height }, player.pos, ctx.time);
      return launchAirtime(height);
    },
    scheduleFollowUp: pending => { ctx.pendingBurstSpreadFollowUps.push(pending); },
    scheduleTwister: pending => { ctx.pendingTwisters.push(pending); },
    placeTrap: trap => {
      ctx.forcedMarches.push({
        id: trap.id,
        name: trap.name,
        pos: trap.pos,
        radius: trap.radius,
        direction: trap.direction,
        distance: trap.distance,
        preDelay: trap.preDelay,
        postDelay: PLANT_TRAP_RECOVERY,
        relativeMove: true,
        armedAt: trap.armedAt,
        expireAt: trap.expireAt,
        triggered: false,
        teleported: false,
      });
    },
  };
}
