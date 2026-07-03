import type { Scene } from "@babylonjs/core/scene";
import type { ActiveMechanic, Boss } from "@shared/types";
import { createHandMesh, updateHandMesh, type HandSide } from "./meshes/handMeshes";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

const SLAP_HAPPY_HAND = /^slap-happy-\d+-(left|right)-hit-\d+$/;

export class HandLayer {
  private hand: Mesh | null = null;

  constructor(private scene: Scene) {}

  sync(active: ActiveMechanic[], bosses: Boss[]): void {
    const mechanic = active.find(m => m.bossId === "bigkefka" && !m.resolved && SLAP_HAPPY_HAND.test(m.id));
    const boss = bosses.find(b => b.id === "bigkefka");
    if (!mechanic || !boss) {
      this.dispose();
      return;
    }

    const side: HandSide = mechanic.id.includes("-left-") ? "left" : "right";
    this.hand ??= createHandMesh(this.scene);
    updateHandMesh(this.hand, boss, side);
  }

  dispose(): void {
    this.hand?.dispose(false, true);
    this.hand = null;
  }
}
