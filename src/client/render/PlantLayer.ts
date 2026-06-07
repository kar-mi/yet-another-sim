import type { Scene } from "@babylonjs/core/scene";
import type { Player } from "../../shared/types";
import { createPlantArrow, updatePlantArrow, type PlantArrow } from "./plantMeshes";

// Draws a floor arrow under every living player carrying an active "plant" debuff, pointing the way
// they'll be knocked when it expires. One arrow per player+effect; cleaned up when the effect drops.
export class PlantLayer {
  private arrows = new Map<string, PlantArrow>();

  constructor(private scene: Scene) {}

  sync(players: Player[], time: number): void {
    const active = new Set<string>();
    for (const p of players) {
      if (!p.alive) continue;
      for (const e of p.effects) {
        if (e.behavior.kind !== "plant" || e.appliedAt + e.duration <= time) continue;
        const key = `${p.id}:${e.id}`;
        active.add(key);
        let arrow = this.arrows.get(key);
        if (!arrow) {
          arrow = createPlantArrow(this.scene, key, e.behavior.direction);
          this.arrows.set(key, arrow);
        }
        updatePlantArrow(arrow, p.pos, e.appliedAt + e.duration - time, time);
      }
    }
    for (const [key, arrow] of this.arrows) {
      if (!active.has(key)) {
        for (const mesh of arrow.all) mesh.dispose(false, true);
        this.arrows.delete(key);
      }
    }
  }

  dispose(): void {
    for (const arrow of this.arrows.values()) {
      for (const mesh of arrow.all) mesh.dispose(false, true);
    }
    this.arrows.clear();
  }
}
