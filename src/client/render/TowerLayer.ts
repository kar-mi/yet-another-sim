import type { Scene } from "@babylonjs/core/scene";
import type { ActiveTower } from "../../shared/types";
import { createTowerMeshes, updateTowerMeshes, type TowerMeshes } from "./towerMeshes";

export class TowerLayer {
  private towers = new Map<string, TowerMeshes>();

  constructor(private scene: Scene) {}

  sync(towers: ActiveTower[], time: number): void {
    const activeIds = new Set(towers.map(t => t.id));
    for (const [id, handle] of this.towers) {
      if (!activeIds.has(id)) {
        for (const mesh of handle.all) mesh.dispose(false, true);
        this.towers.delete(id);
      }
    }

    for (const tower of towers) {
      let handle = this.towers.get(tower.id);
      if (!handle) {
        handle = createTowerMeshes(this.scene, tower);
        this.towers.set(tower.id, handle);
      }
      updateTowerMeshes(handle, tower, time);
    }
  }

  dispose(): void {
    for (const handle of this.towers.values()) {
      for (const mesh of handle.all) mesh.dispose(false, true);
    }
    this.towers.clear();
  }
}
