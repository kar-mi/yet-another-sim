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
import { activeEffectOfKind } from "../engine/systems/helpers";
import { isOnFloor } from "../engine/shapes";

const SNAP_THRESHOLD = 3;  // yalms: divergence past this hard-resets (teleport, forced march, respawn)
// Drift correction. The predicted lead over the authoritative position is legitimate (it masks input
// latency) and resolves on its own when you stop, so we must NOT reconcile while moving or while the
// server is still catching up — that pulls the char backward against in-flight input (rubber banding,
// worst on small taps). Instead, only once you're idle AND the authoritative position has itself been
// still for SETTLE_DELAY, ease out the residual integration/dropped-tick drift. So in clean conditions
// (no drift) this is a no-op; it only acts when a real offset has accumulated. Frame-rate independent.
const SETTLE_EPSILON = 0.02;     // yalms: authoritative move below this counts as "not moving"
const SETTLE_DELAY = 0.15;       // s: authoritative must be still this long before easing drift
const RECONCILE_RATE_IDLE = 8;   // 1/s: drift ease-out once settled (~0.4s), no backward pull

export class LocalPredictor {
  private active = false;
  private pos = { x: 0, z: 0 };
  private facing = 0;
  private y = 0;
  private verticalVelocity = 0;
  private sprintActive = 0;
  private sprintCooldown = 0;
  private lastAuthPos: { x: number; z: number } | null = null;
  private lastAuthMoveTime = 0;

  reset(): void {
    this.active = false;
    this.lastAuthPos = null;
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
      activeEffectOfKind(authLocal, time, "sleep") !== null ||
      activeEffectOfKind(authLocal, time, "confusion") !== null;
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

    // Drift correction (see constants). Track authoritative motion so we only ease out residual drift
    // once both the input has stopped and the server position has settled — never while moving or
    // during the post-stop catch-up window, which would pull the char backward (rubber banding). A
    // large unmodeled jump still hard-snaps.
    const authMoved = this.lastAuthPos ? length(sub(authLocal.pos, this.lastAuthPos)) : Infinity;
    if (authMoved > SETTLE_EPSILON) this.lastAuthMoveTime = time;
    this.lastAuthPos = { x: authLocal.pos.x, z: authLocal.pos.z };

    const err = sub(authLocal.pos, this.pos);
    if (length(err) > SNAP_THRESHOLD) {
      this.pos = { ...authLocal.pos }; // teleport / forced march / respawn
    } else if (length(intent.move) === 0 && time - this.lastAuthMoveTime > SETTLE_DELAY) {
      this.pos = add(this.pos, scale(err, 1 - Math.exp(-RECONCILE_RATE_IDLE * dt)));
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
