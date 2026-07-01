import type { Scene } from "@babylonjs/core/scene";
import type { ActiveHazard } from "@shared/types";
import { createHazardMeshes, updateHazardMeshes, type HazardMeshes } from "./meshes/hazardMeshes";

export class HazardLayer {
  private hazards = new Map<string, HazardMeshes>();

  constructor(private scene: Scene) {}

  sync(hazards: ActiveHazard[], time: number): void {
    const activeIds = new Set(hazards.map(hazard => hazard.id));
    for (const [id, handle] of this.hazards) {
      if (!activeIds.has(id)) {
        for (const mesh of handle.all) mesh.dispose(false, true);
        this.hazards.delete(id);
      }
    }

    for (const hazard of hazards) {
      let handle = this.hazards.get(hazard.id);
      if (!handle) {
        handle = createHazardMeshes(this.scene, hazard);
        this.hazards.set(hazard.id, handle);
      }
      updateHazardMeshes(handle, hazard, time);
    }
  }

  dispose(): void {
    for (const handle of this.hazards.values()) {
      for (const mesh of handle.all) mesh.dispose(false, true);
    }
    this.hazards.clear();
  }
}
