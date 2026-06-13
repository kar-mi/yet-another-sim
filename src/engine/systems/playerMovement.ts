// Phase 1: per-player movement, jump/sprint/anti-knockback/provoke cooldowns, confusion walk,
// forced-movement (knockback) carry, vertical physics, and void death. Mutates players, the boss
// threat table (provoke), the log, and the actedByPlayer map (read later by status-effect dots).

import type { TickContext } from "./context";
import type { EffectBehavior } from "@shared/types";
import { add, sub, scale, normalize, length } from "@shared/math";
import { isOnFloor } from "../shapes";
import { atan2 } from "@shared/dmath";
import { activeEffectOfKind, didAct, applyMechanicDamage } from "./helpers";
import {
  MOVE_SPEED, SPRINT_MULTIPLIER, JUMP_SPEED, GRAVITY, DEATH_FLOOR_Y,
  SPRINT_DURATION, SPRINT_COOLDOWN, ANTI_KB_DURATION, ANTI_KB_COOLDOWN,
  PROVOKE_COOLDOWN, PROVOKE_LEAD, KNOCKBACK_FRICTION,
} from "@shared/constants";

export function applyPlayerMovement(ctx: TickContext): void {
  const { players, boss, log, time, dt, intents, actedByPlayer } = ctx;
  for (const player of players) {
    if (!player.alive) continue;
    // Sleep disables all input for its duration; confusion overrides movement (handled below).
    const asleep = activeEffectOfKind(player, time, "sleep") !== null;
    const confusion = asleep ? null : activeEffectOfKind(player, time, "confusion");
    const intent = asleep ? undefined : intents[player.id];
    actedByPlayer.set(player.id, didAct(intent) || confusion !== null);

    if (intent?.jump && player.y === 0) {
      player.verticalVelocity = JUMP_SPEED;
    }

    if (intent?.sprint && player.sprintCooldown <= 0) {
      player.sprintActive = SPRINT_DURATION;
      player.sprintCooldown = SPRINT_COOLDOWN;
    }
    if (player.sprintCooldown > 0) player.sprintCooldown = Math.max(0, player.sprintCooldown - dt);
    if (player.sprintActive > 0) player.sprintActive = Math.max(0, player.sprintActive - dt);

    if (intent?.antiKnockback && player.antiKbCooldown <= 0) {
      player.antiKbActive = ANTI_KB_DURATION;
      player.antiKbCooldown = ANTI_KB_COOLDOWN;
    }

    // Provoke: tank-only threat grab. Sets the tank above the current max so the boss
    // retargets them in this tick's targeting pass (section 1b, below the loop).
    if (intent?.provoke && player.role === "tank" && player.provokeCooldown <= 0) {
      const maxThreat = Math.max(0, ...Object.values(boss.threat));
      boss.threat[player.id] = maxThreat + PROVOKE_LEAD;
      player.provokeCooldown = PROVOKE_COOLDOWN;
    }
    if (player.provokeCooldown > 0) player.provokeCooldown = Math.max(0, player.provokeCooldown - dt);

    if (intent?.toggleInvincibility) {
      player.invincible = !player.invincible;
    }
    if (player.antiKbCooldown > 0) player.antiKbCooldown = Math.max(0, player.antiKbCooldown - dt);
    if (player.antiKbActive > 0) player.antiKbActive = Math.max(0, player.antiKbActive - dt);

    // Forced movement (knockback/knockup) suppresses normal input while it carries the player.
    const beingKnocked = length(player.knockbackVelocity) > 1e-6;
    const speed = player.sprintActive > 0 ? MOVE_SPEED * SPRINT_MULTIPLIER : MOVE_SPEED;
    if (!beingKnocked && confusion) {
      // Confusion: walk toward the locked target. On contact the target takes the hit and it ends.
      const target = players.find(p => p.id === confusion.lockedTargetId && p.alive);
      const cb = confusion.behavior as Extract<EffectBehavior, { kind: "confusion" }>;
      if (target) {
        const toTarget = sub(target.pos, player.pos);
        if (length(toTarget) <= cb.radius) {
          applyMechanicDamage(target, cb.damage, cb.damageType, time);
          player.effects = player.effects.filter(e => e.id !== confusion.id);
          log.push({ t: time, mechanic: confusion.name, playerId: target.id, event: "hit" });
        } else {
          player.pos = add(player.pos, scale(normalize(toTarget), MOVE_SPEED * dt));
          player.facing = atan2(toTarget.x, toTarget.z);
        }
      }
    } else if (!beingKnocked && intent && length(intent.move) > 0) {
      player.pos = add(player.pos, scale(normalize(intent.move), speed * dt));
      player.facing = intent.facing ?? atan2(intent.move.x, intent.move.z);
    } else if (!beingKnocked && intent && intent.facing !== undefined) {
      // Facing-only update (e.g. turning in place while stationary).
      player.facing = intent.facing;
    }
    if (beingKnocked) {
      player.pos = add(player.pos, scale(player.knockbackVelocity, dt));
    }

    // Vertical physics: gravity applies while airborne or while over the void (off-floor).
    // Landing only catches a player descending through the floor from above (prevY >= 0),
    // so a player who has already sunk below the floor keeps falling even back over a zone.
    const grounded = isOnFloor(player.pos, ctx.world.arena.zones);

    // Ground friction decelerates a horizontal knockback to rest after its target distance.
    // An airborne knockup keeps constant horizontal velocity until it lands.
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
        player.knockbackVelocity = { x: 0, z: 0 }; // a knockup lands cleanly at its target distance
      }
    }

    // Falling off the map kills even an invincible player — invincibility only negates damage.
    if (player.y <= DEATH_FLOOR_Y) {
      player.hp = 0;
      player.alive = false;
      player.verticalVelocity = 0;
      log.push({ t: time, mechanic: "arena", playerId: player.id, event: "fell" });
    }
  }
}
