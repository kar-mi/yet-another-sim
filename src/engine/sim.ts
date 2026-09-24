import type { World, Intents, PendingHeal } from "@model/types";
import { atan2 } from "@shared/dmath";
import { sub, normalize, scale, add, length } from "@shared/math";
import { createTickContext } from "./systems/context";
import { topThreatTarget } from "./systems/helpers";
import { applyPlayerMovement } from "./systems/playerMovement";
import { applyStatusEffects } from "./systems/statusEffects";
import { holdUntilFromResolves } from "./bots/genericSolver";
import { REGISTRY } from "./mechanicRegistry";
import { BOSS_MOVE_SPEED } from "@shared/constants";

const BOSS_FOLLOW_BUFFER = 1.7;

export function tick(world: World, intents: Intents, dt: number): World {
  const ctx = createTickContext(world, intents, dt);
  const { players, bosses, time } = ctx;

  applyPlayerMovement(ctx);

  for (const heal of world.pendingHeals) {
    if (heal.t <= time) {
      for (const player of players) {
        if (player.alive) player.hp = player.maxHp;
      }
    }
  }
  const remainingPendingHeals: PendingHeal[] = world.pendingHeals.filter(heal => heal.t > time);

  for (const boss of bosses) {
    if (boss.targetable === false) {
      boss.currentTarget = null;
      continue;
    }
    boss.currentTarget = topThreatTarget(players, boss.threat);
    const activeCast = (m: { bossId?: string; resolved: boolean; telegraphStart: number; resolveAt: number }) =>
      !m.resolved && m.telegraphStart <= time && m.resolveAt > time
      && (m.bossId ?? bosses[0]!.id) === boss.id;
    const facingLocked = world.active.some(m => m.lockFacing && activeCast(m));
    const movementLocked = world.active.some(m => m.bossStationary && activeCast(m));
    if (boss.currentTarget && !facingLocked) {
      const target = players.find(p => p.id === boss.currentTarget)!;
      const toTarget = sub(target.pos, boss.pos);
      boss.facing = atan2(toTarget.x, toTarget.z);
      if (!movementLocked) {
        const dist = length(toTarget);
        const stopRange = boss.radius * boss.ringScale + BOSS_FOLLOW_BUFFER;
        if (dist > stopRange) {
          boss.pos = add(boss.pos, scale(normalize(toTarget), Math.min(BOSS_MOVE_SPEED * dt, dist - stopRange)));
        }
      }
    }
  }

  const next: World = { ...world, time, players, boss: bosses[0]!, bosses };
  for (const mechanic of REGISTRY) {
    if (mechanic.resolve) Object.assign(next, mechanic.resolve(ctx));
  }

  applyStatusEffects(ctx);

  next.rngState = ctx.rngState;
  next.groupChoices = ctx.groupChoices;
  next.log = ctx.log;
  next.forcedMarches = ctx.forcedMarches;
  next.active = [...next.active, ...ctx.resolvedAoeVisuals];
  next.pendingHeals = remainingPendingHeals;
  next.pendingBurstSpreadFollowUps = ctx.pendingBurstSpreadFollowUps;
  next.pendingTwisters = ctx.pendingTwisters;

  const hold = holdUntilFromResolves(next, ctx.previousTime);
  if (hold !== undefined) next.botHoldUntil = Math.max(next.botHoldUntil ?? 0, hold);

  const anyAlive = players.some(p => p.alive);
  const allResolved = REGISTRY.every(mechanic => mechanic.isResolved ? mechanic.isResolved(next) : true);
  let status = world.status;
  if (status === "running") {
    if (!anyAlive) {
      status = "wiped";
    } else if (world.hasMechanics && allResolved && time >= world.duration) {
      status = "cleared";
    }
  }
  next.status = status;
  return next;
}
