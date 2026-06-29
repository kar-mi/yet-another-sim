// Render-only client-side prediction for the LOCAL player. The netcode is deterministic lockstep:
// the client only sees its own input after it round-trips the server, plus a 33ms render-delay.
// This integrates the current input immediately so the local player moves with no perceptible
// delay, then springs toward the latest authoritative position so any error eases out instead of
// snapping. It never touches the authoritative world — mechanics, worldHash, and desync detection
// stay server-tick authoritative (see "Option C" in the input-delay plan).

import type { Intent, Player, ZoneShape } from "@shared/types";
import { add, sub, scale, normalize, length } from "@shared/math";
import { atan2 } from "@shared/dmath";
import { MOVE_SPEED, SPRINT_MULTIPLIER, JUMP_SPEED, GRAVITY, SPRINT_DURATION, SPRINT_COOLDOWN } from "@shared/constants";
import { hasInputDisablingEffect } from "../engine/status/behaviors";
import { isOnFloor } from "../engine/shapes";

const SNAP_THRESHOLD = 3;  // yalms: divergence past this hard-resets (teleport, forced march, respawn)

export class LocalPredictor {
  private active = false;
  private pos = { x: 0, z: 0 };
  private facing = 0;
  private y = 0;
  private verticalVelocity = 0;
  private sprintActive = 0;
  private sprintCooldown = 0;

  reset(): void {
    this.active = false;
  }

  // Predict the local player's pos/facing/y from `intent` over `dt`, anchored to the latest
  // authoritative state `authLocal`, and return a new Player to render. Returns `authLocal`
  // unchanged whenever prediction is disabled (server-driven states).
  predict(authLocal: Player, zones: ZoneShape[], time: number, intent: Intent, dt: number): Player {
    // Server-driven states: yield to the authoritative position (no input integration). The sleep
    // check also covers forced-march traps, which freeze the captured player with a sleep effect.
    const forced =
      !authLocal.alive ||
      length(authLocal.knockbackVelocity) > 1e-6 ||
      hasInputDisablingEffect(authLocal, time);
    if (forced) {
      this.seed(authLocal);
      return authLocal;
    }

    if (!this.active) this.seed(authLocal);

    // Predict sprint locally so the speed boost is instant (mirrors playerMovement.ts). Gated on the
    // predicted cooldown so we don't speed up when the server would reject the sprint.
    if (intent.sprint && this.sprintCooldown <= 0) {
      this.sprintActive = SPRINT_DURATION;
      this.sprintCooldown = SPRINT_COOLDOWN;
    }
    if (this.sprintCooldown > 0) this.sprintCooldown = Math.max(0, this.sprintCooldown - dt);
    if (this.sprintActive > 0) this.sprintActive = Math.max(0, this.sprintActive - dt);

    // Integrate input — mirrors playerMovement.ts locomotion.
    const speed = this.sprintActive > 0 ? MOVE_SPEED * SPRINT_MULTIPLIER : MOVE_SPEED;
    if (length(intent.move) > 0) {
      this.pos = add(this.pos, scale(normalize(intent.move), speed * dt));
      this.facing = intent.facing ?? atan2(intent.move.x, intent.move.z);
    } else if (intent.facing !== undefined) {
      this.facing = intent.facing;
    }

    // Vertical physics — mirrors playerMovement.ts. Jump fires off the predicted ground state so it
    // launches the instant the key is pressed; gravity integrates independently of the authoritative
    // arc (each landing resets to y=0, so no drift accumulates).
    if (intent.jump && this.y <= 0 && this.verticalVelocity === 0) this.verticalVelocity = JUMP_SPEED;
    const grounded = isOnFloor(this.pos, zones);
    if (!grounded || this.y > 0 || this.verticalVelocity !== 0) {
      const prevY = this.y;
      this.y += this.verticalVelocity * dt;
      this.verticalVelocity -= GRAVITY * dt;
      if (grounded && prevY >= 0 && this.y <= 0) {
        this.y = 0;
        this.verticalVelocity = 0;
      }
    }

    // No drift reconciliation: with the server no longer dropping sim ticks, the authoritative path is
    // the same function of the same inputs as this prediction, so it converges to the predicted
    // position on its own (RTT-late) with no steady drift. The only correction is a hard snap on a
    // divergence too large to model — teleport, forced march, respawn.
    if (length(sub(authLocal.pos, this.pos)) > SNAP_THRESHOLD) {
      this.pos = { ...authLocal.pos };
    }

    return { ...authLocal, pos: { ...this.pos }, facing: this.facing, y: this.y };
  }

  private seed(authLocal: Player): void {
    this.pos = { ...authLocal.pos };
    this.facing = authLocal.facing;
    this.y = authLocal.y;
    this.verticalVelocity = authLocal.verticalVelocity;
    this.sprintActive = authLocal.sprintActive;
    this.sprintCooldown = authLocal.sprintCooldown;
    this.active = true;
  }
}
