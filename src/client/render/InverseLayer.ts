import type { Scene } from "@babylonjs/core/scene";
import type { ActiveInverse, Boss } from "../../shared/types";
import {
  createInverseMeshes,
  updateInverseMeshes,
  createOrbRings,
  updateOrbRings,
  setOrbRingsEnabled,
  type InverseMeshes,
  type OrbRings,
} from "./inverseMeshes";

export class InverseLayer {
  private inversions = new Map<string, InverseMeshes>();
  private rings: OrbRings | null = null;

  constructor(private scene: Scene) {}

  sync(inversions: ActiveInverse[], boss: Boss, time: number): void {
    const activeIds = new Set(inversions.map(i => i.id));
    for (const [id, handle] of this.inversions) {
      if (!activeIds.has(id)) {
        for (const mesh of handle.all) mesh.dispose(false, true);
        this.inversions.delete(id);
      }
    }

    for (const inv of inversions) {
      let handle = this.inversions.get(inv.id);
      if (!handle) {
        handle = createInverseMeshes(this.scene, inv);
        this.inversions.set(inv.id, handle);
      }
      updateInverseMeshes(handle, inv, time);
    }

    // One shared set of fire/ice rings circles the boss whenever a "?" mechanic is active.
    if (!this.rings) this.rings = createOrbRings(this.scene);
    const active = inversions.length > 0;
    setOrbRingsEnabled(this.rings, active);
    if (active) updateOrbRings(this.rings, boss, time);
  }

  dispose(): void {
    for (const handle of this.inversions.values()) {
      for (const mesh of handle.all) mesh.dispose(false, true);
    }
    this.inversions.clear();
    if (this.rings) {
      for (const mesh of this.rings.all) mesh.dispose(false, true);
      this.rings = null;
    }
  }
}
