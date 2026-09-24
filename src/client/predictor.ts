import type { Intent, Player, ZoneShape } from "@model/types";
import { add, sub, scale, normalize, length } from "@shared/math";
import { atan2 } from "@shared/dmath";
import { MOVE_SPEED, JUMP_SPEED, GRAVITY, SPRINT_COOLDOWN } from "@shared/constants";
import { applyStatus, isInputDisabled, isStatusActive, movementSpeedMultiplier, requireStatus, type ApplyEnv, type StatusActor } from "@status";
import { isOnFloor } from "@arena";

const SNAP_THRESHOLD = 3;
const SPRINT = requireStatus("sprint");

export class LocalPredictor {
  private active = false;
  private pos = { x: 0, z: 0 };
  private facing = 0;
  private y = 0;
  private verticalVelocity = 0;
  private clock = 0;
  private statusActor: StatusActor | null = null;
  private sprintCooldown = 0;

  reset(): void {
    this.active = false;
  }

  predict(authLocal: Player, zones: ZoneShape[], time: number, intent: Intent, dt: number): Player {
    const forced =
      !authLocal.alive ||
      length(authLocal.knockbackVelocity) > 1e-6 ||
      isInputDisabled(authLocal, time);
    if (forced) {
      this.seed(authLocal, time);
      return authLocal;
    }

    if (!this.active) this.seed(authLocal, time);
    this.reconcileStatuses(authLocal);
    const statusActor = this.statusActor!;

    this.clock += dt;
    if (authLocal.cooldownsDisabled) this.sprintCooldown = 0;
    if (intent.sprint && this.sprintCooldown <= 0) {
      applyStatus(statusActor, SPRINT, `${authLocal.id}-sprint`, this.statusEnv());
      this.sprintCooldown = authLocal.cooldownsDisabled ? 0 : SPRINT_COOLDOWN;
    }
    if (this.sprintCooldown > 0) this.sprintCooldown = Math.max(0, this.sprintCooldown - dt);

    const speed = MOVE_SPEED * movementSpeedMultiplier(statusActor, this.clock);
    if (length(intent.move) > 0) {
      this.pos = add(this.pos, scale(normalize(intent.move), speed * dt));
      this.facing = intent.facing ?? atan2(intent.move.x, intent.move.z);
    } else if (intent.facing !== undefined) {
      this.facing = intent.facing;
    }

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

    if (length(sub(authLocal.pos, this.pos)) > SNAP_THRESHOLD) {
      this.pos = { ...authLocal.pos };
    }

    return { ...authLocal, pos: { ...this.pos }, facing: this.facing, y: this.y };
  }

  private statusEnv(): ApplyEnv {
    return { time: this.clock, actors: [], damage: () => {} };
  }

  private seed(authLocal: Player, time: number): void {
    this.pos = { ...authLocal.pos };
    this.facing = authLocal.facing;
    this.y = authLocal.y;
    this.verticalVelocity = authLocal.verticalVelocity;
    this.clock = time;
    this.statusActor = { ...authLocal, effects: authLocal.effects.slice() };
    this.sprintCooldown = authLocal.sprintCooldown;
    this.active = true;
  }

  private reconcileStatuses(authLocal: Player): void {
    const localSprint = this.statusActor!.effects.find(effect =>
      effect.id === `${authLocal.id}-sprint`
      && isStatusActive(effect, this.clock)
      && !authLocal.effects.some(authoritative => authoritative.id === effect.id));
    this.statusActor = {
      ...this.statusActor!,
      effects: localSprint ? [...authLocal.effects, localSprint] : authLocal.effects.slice(),
    };
  }
}
