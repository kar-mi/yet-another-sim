import type { Scene } from "@babylonjs/core/scene";
import type { ActiveForcedMarch } from "../../shared/types";
import { createForcedMarchMeshes, updateForcedMarchMeshes, type ForcedMarchMeshes } from "./meshes/forcedMarchMeshes";

export class ForcedMarchLayer {
  private marches = new Map<string, ForcedMarchMeshes>();

  constructor(private scene: Scene) {}

  sync(marches: ActiveForcedMarch[], time: number): void {
    const activeIds = new Set(marches.map(m => m.id));
    for (const [id, handle] of this.marches) {
      if (!activeIds.has(id)) {
        for (const mesh of handle.all) mesh.dispose(false, true);
        this.marches.delete(id);
      }
    }

    for (const fm of marches) {
      let handle = this.marches.get(fm.id);
      if (!handle) {
        handle = createForcedMarchMeshes(this.scene, fm);
        this.marches.set(fm.id, handle);
      }
      updateForcedMarchMeshes(handle, fm, time);
    }
  }

  dispose(): void {
    for (const handle of this.marches.values()) {
      for (const mesh of handle.all) mesh.dispose(false, true);
    }
    this.marches.clear();
  }
}
