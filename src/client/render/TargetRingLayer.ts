import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { Boss } from "@model/types";
import { createGlowRing, type GlowRing } from "@effects/babylon";

const RING_Y = 0.04;
const RING_SCALE = 1.03;
const RING_THICKNESS = 0.07;
const COLOR = new Color3(1, 0.96, 0.55);

export class TargetRingLayer {
  private ring?: GlowRing;

  constructor(private scene: Scene) {}

  sync(boss: Boss, isTargeted: boolean): void {
    if (!this.ring) {
      this.ring = createGlowRing(this.scene, "target-ring", {
        diameter: boss.radius * boss.ringScale * 2 * RING_SCALE,
        thickness: RING_THICKNESS,
        color: COLOR,
        backFaceCulling: false,
      });
    }
    this.ring.mesh.position.set(boss.pos.x, RING_Y, boss.pos.z);
    this.ring.mesh.setEnabled(boss.hp > 0 && isTargeted && boss.targetable !== false);
  }

  dispose(): void {
    this.ring?.mesh.dispose(false, true);
    this.ring = undefined;
  }
}
