import type { TickContext } from "./context";
import { resolveBurstFollowUp, tickStatuses } from "@status";
import { statusServices } from "./statusServices";
import { addResolvedAoeVisual } from "./effectResolvers";
import { hitPlayersInShape } from "./strikes";

export function applyStatusEffects(ctx: TickContext): void {
  const { players, time, actedByPlayer } = ctx;
  const services = statusServices(ctx);
  const remainingFollowUps = [];
  for (const pending of ctx.pendingBurstSpreadFollowUps) {
    if (pending.t > time) {
      remainingFollowUps.push(pending);
      continue;
    }
    const origin = ctx.world.crystals.find(crystal => crystal.element === pending.originCrystal)?.pos ?? { x: 0, z: 0 };
    resolveBurstFollowUp(services, pending.id, { key: pending.id, name: pending.name, avoidable: pending.avoidable === true }, pending.followUp, origin);
  }
  ctx.pendingBurstSpreadFollowUps = remainingFollowUps;
  const remainingTwisters = [];
  for (const pending of ctx.pendingTwisters) {
    if (pending.t > time) {
      remainingTwisters.push(pending);
      continue;
    }
    hitPlayersInShape(ctx, pending.shape, pending.damage, pending.damageType,
      { key: pending.id, name: pending.name, avoidable: pending.avoidable === true });
    addResolvedAoeVisual(ctx, `${pending.id}-twister`, pending.name, pending.shape);
  }
  ctx.pendingTwisters = remainingTwisters;
  for (const player of players) {
    const intent = ctx.intents[player.id];
    if (intent?.jump || (intent !== undefined && (intent.move.x !== 0 || intent.move.z !== 0))) {
      player.lastMotionAt = time;
    }
  }
  tickStatuses(services, player => actedByPlayer.get(player.id) ?? false);
}
