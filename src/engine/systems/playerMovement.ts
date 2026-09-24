import type { TickContext } from "./context";
import { add, sub, scale, normalize, length } from "@shared/math";
import { isOnFloor } from "@arena";
import { atan2 } from "@shared/dmath";
import { applyStatus, movementControl, movementSpeedMultiplier, requireStatus, resolveForcedWalk } from "@status";
import { didAct } from "./helpers";
import { FALL_SOURCE, recordDeath } from "./damageLog";
import { statusServices } from "./statusServices";
import {
  MOVE_SPEED, JUMP_SPEED, GRAVITY, DEATH_FLOOR_Y, SPRINT_COOLDOWN, ANTI_KB_COOLDOWN,
  PROVOKE_COOLDOWN, PROVOKE_LEAD, KNOCKBACK_FRICTION,
} from "@shared/constants";

const SPRINT = requireStatus("sprint");
const ARMS_LENGTH = requireStatus("arms_length");

export function applyPlayerMovement(ctx: TickContext): void {
  const { players, bosses, log, time, dt, intents, actedByPlayer } = ctx;
  for (const player of players) {
    if (!player.alive) continue;
    const control = movementControl(player, time);
    const forcedWalk = control.forcedWalk;
    const intent = control.frozen ? undefined : intents[player.id];
    if (intents[player.id]?.solverDirected) player.botWaypointResumeAfter = ctx.previousTime;
    actedByPlayer.set(player.id, didAct(intent) || forcedWalk !== undefined);

    if (intent?.toggleCooldowns) player.cooldownsDisabled = !player.cooldownsDisabled;
    if (player.cooldownsDisabled) {
      player.sprintCooldown = 0;
      player.antiKbCooldown = 0;
      player.provokeCooldown = 0;
    }

    if (intent?.jump && player.y === 0) {
      player.verticalVelocity = JUMP_SPEED;
    }

    if (intent?.sprint && player.sprintCooldown <= 0) {
      applyStatus(player, SPRINT, `${player.id}-sprint`, statusServices(ctx));
      player.sprintCooldown = player.cooldownsDisabled ? 0 : SPRINT_COOLDOWN;
    }
    if (player.sprintCooldown > 0) player.sprintCooldown = Math.max(0, player.sprintCooldown - dt);

    if (intent?.antiKnockback && player.antiKbCooldown <= 0) {
      applyStatus(player, ARMS_LENGTH, `${player.id}-arms-length`, statusServices(ctx));
      player.antiKbCooldown = player.cooldownsDisabled ? 0 : ANTI_KB_COOLDOWN;
    }

    if (intent?.cycleTarget) {
      const aliveBosses = bosses.filter(b => b.hp > 0 && b.targetable !== false);
      if (aliveBosses.length > 0) {
        const cur = aliveBosses.findIndex(b => b.id === player.targetBossId);
        player.targetBossId = aliveBosses[(cur + 1) % aliveBosses.length]!.id;
      }
    }

    if (intent?.provoke && player.role === "tank" && player.provokeCooldown <= 0) {
      const target = bosses.find(b => b.id === player.targetBossId && b.hp > 0 && b.targetable !== false) ?? bosses.find(b => b.targetable !== false);
      if (target) {
        const maxThreat = Math.max(0, ...Object.values(target.threat));
        target.threat[player.id] = maxThreat + PROVOKE_LEAD;
      }
      player.provokeCooldown = player.cooldownsDisabled ? 0 : PROVOKE_COOLDOWN;
    }
    if (player.provokeCooldown > 0) player.provokeCooldown = Math.max(0, player.provokeCooldown - dt);

    if (intent?.toggleInvincibility) {
      player.invincible = !player.invincible;
    }
    if (player.antiKbCooldown > 0) player.antiKbCooldown = Math.max(0, player.antiKbCooldown - dt);

    const beingKnocked = length(player.knockbackVelocity) > 1e-6;
    const speed = MOVE_SPEED * movementSpeedMultiplier(player, time);
    if (!beingKnocked && forcedWalk) {
      const destination = resolveForcedWalk(player, forcedWalk, statusServices(ctx));
      if (destination) {
        const toTarget = sub(destination, player.pos);
        player.pos = add(player.pos, scale(normalize(toTarget), MOVE_SPEED * dt));
        player.facing = atan2(toTarget.x, toTarget.z);
      }
    } else if (!beingKnocked && intent && length(intent.move) > 0) {
      player.pos = add(player.pos, scale(normalize(intent.move), speed * dt));
      player.facing = intent.facing ?? atan2(intent.move.x, intent.move.z);
    } else if (!beingKnocked && intent && intent.facing !== undefined) {
      player.facing = intent.facing;
    }
    if (beingKnocked) {
      player.pos = add(player.pos, scale(player.knockbackVelocity, dt));
    }

    const grounded = isOnFloor(player.pos, ctx.world.arena.zones);

    if (beingKnocked && grounded && player.y <= 0) {
      const sp = Math.max(0, length(player.knockbackVelocity) - KNOCKBACK_FRICTION * dt);
      player.knockbackVelocity = sp > 0 ? scale(normalize(player.knockbackVelocity), sp) : { x: 0, z: 0 };
    }

    if (!grounded || player.y > 0 || player.verticalVelocity !== 0) {
      const prevY = player.y;
      player.y += player.verticalVelocity * dt;
      player.verticalVelocity -= GRAVITY * dt;
      if (grounded && prevY >= 0 && player.y <= 0) {
        player.y = 0;
        player.verticalVelocity = 0;
        player.knockbackVelocity = { x: 0, z: 0 };
      }
    }

    if (player.y <= DEATH_FLOOR_Y) {
      const wasAlive = player.alive;
      player.hp = 0;
      player.alive = false;
      player.verticalVelocity = 0;
      log.push({ t: time, mechanic: "arena", playerId: player.id, event: "fell" });
      if (wasAlive) recordDeath(ctx, player, FALL_SOURCE);
    }
  }
}
