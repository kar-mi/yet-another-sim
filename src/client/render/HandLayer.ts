import type { Scene } from "@babylonjs/core/scene";
import type { ActiveMechanic, Boss } from "@shared/types";
import {
  createHandMeshes,
  disposeHandMeshes,
  updateHandMeshes,
  type HandMeshes,
} from "./meshes/handMeshes";

const SLAP_HAPPY_HAND = /^slap-happy-\d+-(left|right)-hit-\d+$/;
const SLAP_HAPPY_PLACED = /^slap-happy-\d+-hands-placed$/;

export class HandLayer {
  private left: HandMeshes | null = null;
  private right: HandMeshes | null = null;

  constructor(private scene: Scene) {}

  sync(active: ActiveMechanic[], bosses: Boss[]): void {
    const boss = bosses.find(b => b.id === "bigkefka");
    const hit = active.find(m => m.bossId === "bigkefka" && !m.resolved && SLAP_HAPPY_HAND.test(m.id));
    const placed = active.find(m => m.bossId === "bigkefka" && !m.resolved && SLAP_HAPPY_PLACED.test(m.id));

    if (!boss || (!hit && !placed)) {
      this.dispose();
      return;
    }

    const raisedSide = hit ? (hit.id.includes("-left-") ? "left" : "right") : null;

    this.left ??= createHandMeshes(this.scene, "slap-happy-hand-left");
    this.right ??= createHandMeshes(this.scene, "slap-happy-hand-right");
    updateHandMeshes(this.left, boss, "left", raisedSide === "left" ? "raised" : "ground");
    updateHandMeshes(this.right, boss, "right", raisedSide === "right" ? "raised" : "ground");
  }

  dispose(): void {
    disposeHandMeshes(this.left);
    disposeHandMeshes(this.right);
    this.left = null;
    this.right = null;
  }
}
