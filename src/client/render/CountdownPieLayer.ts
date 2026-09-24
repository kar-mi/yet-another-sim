import type { Scene } from "@babylonjs/core/scene";
import type { Player } from "@model/types";
import { countdownSlicesLeft } from "@model/countdown";
import { createCountdownPie, COUNTDOWN_PIE_PLANE_RATIO, type CountdownPie } from "@effects/babylon";

// Height above the player's feet.
const PIE_BOTTOM = 2.3;
const PIE_SIZE = 2;

// Show the POV player's countdown above their head.
export class CountdownPieLayer {
  private pie: CountdownPie;

  constructor(scene: Scene) {
    this.pie = createCountdownPie(scene, "countdown-pie", PIE_SIZE * COUNTDOWN_PIE_PLANE_RATIO);
  }

  sync(pov: Player | undefined, time: number): void {
    const effect = pov?.alive
      ? pov.effects
        .filter(e => e.countdown && e.appliedAt + e.duration > time)
        .sort((a, b) => a.appliedAt + a.duration - (b.appliedAt + b.duration))[0]
      : undefined;
    const left = effect ? countdownSlicesLeft(effect, time) : 0;
    if (!pov || !effect || left === 0) {
      this.pie.plane.setEnabled(false);
      return;
    }
    this.pie.draw(left, effect.countdown!.slices);
    this.pie.plane.position.set(pov.pos.x, PIE_BOTTOM + PIE_SIZE / 2 + pov.y, pov.pos.z);
    this.pie.plane.setEnabled(true);
  }

  dispose(): void {
    this.pie.dispose();
  }
}
