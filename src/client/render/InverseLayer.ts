import type { Scene } from "@babylonjs/core/scene";
import type { ActiveInverse, Boss } from "../../shared/types";
import { createInverseMeshes, updateInverseMeshes, type InverseMeshes } from "./inverseMeshes";

export class InverseLayer {
  private inversions = new Map<string, InverseMeshes>();

  constructor(private scene: Scene) {}

  sync(inversions: ActiveInverse[], boss: Boss, time: number): void {
    const activeIds = new Set(inversions.map(i => i.id));
    for (const [id, handle] of this.inversions) {
      if (!activeIds.has(id)) {
        for (const mesh of handle.all) mesh.dispose(false, true);
        this.inversions.delete(id);
      }
    }

    // Stable vertical slot per simultaneous ring: index in the (id-sorted) active list.
    const ordered = [...inversions].sort((a, b) => a.id.localeCompare(b.id));
    ordered.forEach((inv, index) => {
      let handle = this.inversions.get(inv.id);
      if (!handle) {
        handle = createInverseMeshes(this.scene, inv);
        this.inversions.set(inv.id, handle);
      }
      updateInverseMeshes(handle, inv, boss, time, index);
    });
  }

  dispose(): void {
    for (const handle of this.inversions.values()) {
      for (const mesh of handle.all) mesh.dispose(false, true);
    }
    this.inversions.clear();
  }
}
