import type { Scene } from "@babylonjs/core/scene";
import type { ActiveDivebomb } from "@shared/types";
import { createDivebombMeshes, updateDivebombMeshes, type DivebombMeshes } from "./meshes/divebombMeshes";

export class DivebombLayer {
  private divebombs = new Map<string, DivebombMeshes>();

  constructor(private scene: Scene) {}

  sync(divebombs: ActiveDivebomb[], time: number): void {
    const activeIds = new Set(divebombs.map(db => db.id));
    for (const [id, handle] of this.divebombs) {
      if (!activeIds.has(id)) {
        for (const mesh of handle.all) mesh.dispose(false, true);
        this.divebombs.delete(id);
      }
    }

    for (const divebomb of divebombs) {
      let handle = this.divebombs.get(divebomb.id);
      if (!handle) {
        handle = createDivebombMeshes(this.scene, divebomb);
        this.divebombs.set(divebomb.id, handle);
      }
      updateDivebombMeshes(handle, divebomb, time);
    }
  }

  dispose(): void {
    for (const handle of this.divebombs.values()) {
      for (const mesh of handle.all) mesh.dispose(false, true);
    }
    this.divebombs.clear();
  }
}
