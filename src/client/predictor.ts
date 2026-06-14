// Render-only client-side prediction for the LOCAL player. The netcode is deterministic lockstep:
// the client only sees its own input after it round-trips the server, plus a 33ms render-delay.
// This integrates the current input immediately so the local player moves with no perceptible
// delay, then springs toward the latest authoritative position so any error eases out instead of
// snapping. It never touches the authoritative world — mechanics, worldHash, and desync detection
// stay server-tick authoritative (see "Option C" in the input-delay plan).

import type { Intent, Player } from "@shared/types";
import { add, sub, scale, normalize, length } from "@shared/math";
import { atan2 } from "@shared/dmath";
import { MOVE_SPEED, SPRINT_MULTIPLIER } from "@shared/constants";
import { activeEffectOfKind } from "../engine/systems/helpers";

const TAU = 0.1;          // spring time-constant (s): steady-state lead while walking ≈ speed*TAU
const SNAP_THRESHOLD = 3; // yalms: divergence past this hard-resets (teleport, forced march, respawn)

export class LocalPredictor {
  private active = false;
  private pos = { x: 0, z: 0 };
  private facing = 0;

  reset(): void {
    this.active = false;
  }

  // Predict the local player's pos/facing from `intent` over `dt`, anchored to the latest
  // authoritative state `authLocal`, and return a new Player to render. Returns `authLocal`
  // unchanged whenever prediction is disabled (server-driven states).
  predict(authLocal: Player, time: number, intent: Intent, dt: number): Player {
    // Server-driven states: yield to the authoritative position (no input integration). The sleep
    // check also covers forced-march traps, which freeze the captured player with a sleep effect.
    const forced =
      !authLocal.alive ||
      length(authLocal.knockbackVelocity) > 1e-6 ||
      activeEffectOfKind(authLocal, time, "sleep") !== null ||
      activeEffectOfKind(authLocal, time, "confusion") !== null;
    if (forced) {
      this.pos = { ...authLocal.pos };
      this.facing = authLocal.facing;
      this.active = true;
      return authLocal;
    }

    if (!this.active) {
      this.pos = { ...authLocal.pos };
      this.facing = authLocal.facing;
      this.active = true;
    }

    // Integrate input — mirrors playerMovement.ts locomotion.
    const speed = authLocal.sprintActive > 0 ? MOVE_SPEED * SPRINT_MULTIPLIER : MOVE_SPEED;
    if (length(intent.move) > 0) {
      this.pos = add(this.pos, scale(normalize(intent.move), speed * dt));
      this.facing = intent.facing ?? atan2(intent.move.x, intent.move.z);
    } else if (intent.facing !== undefined) {
      this.facing = intent.facing;
    }

    // Reconcile toward the latest authoritative position.
    if (length(sub(authLocal.pos, this.pos)) > SNAP_THRESHOLD) {
      this.pos = { ...authLocal.pos };
    } else {
      const k = 1 - Math.exp(-dt / TAU);
      this.pos = add(this.pos, scale(sub(authLocal.pos, this.pos), k));
    }

    return { ...authLocal, pos: { ...this.pos }, facing: this.facing };
  }
}
