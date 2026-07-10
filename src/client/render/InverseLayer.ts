import type { Scene } from "@babylonjs/core/scene";
import type { ActiveInverse, Boss } from "@shared/types";
import { createQuestionRingForInverse, updateQuestionRingForInverse } from "./meshes/inverseMeshes";
import type { QuestionRingMeshes } from "./meshes/questionRingMeshes";
import { syncFloorAoeMeshes, disposeFloorAoeMeshes, type FloorAoeMeshMap } from "./floorAoeSync";

export class InverseLayer {
  private rings = new Map<string, QuestionRingMeshes>();
  private footprints: FloorAoeMeshMap = new Map();

  constructor(private scene: Scene) {}

  sync(inversions: ActiveInverse[], boss: Boss, time: number): void {
    const activeIds = new Set(inversions.map(i => i.id));
    for (const [id, ring] of this.rings) {
      if (!activeIds.has(id)) {
        for (const mesh of ring.all) mesh.dispose(false, true);
        this.rings.delete(id);
      }
    }

    for (const inv of inversions) {
      let ring = this.rings.get(inv.id);
      if (!ring) {
        ring = createQuestionRingForInverse(this.scene, inv);
        this.rings.set(inv.id, ring);
      }
      updateQuestionRingForInverse(ring, inv, boss, time);
    }

    // Shown-shape telegraph footprints are always drawn; hidden shapes are intentionally not rendered.
    const aoes = inversions.flatMap(inv => inv.floorAoes ?? []);
    const resolvedIds = new Set(inversions.filter(inv => inv.resolved).flatMap(inv => (inv.floorAoes ?? []).map(a => a.id)));
    syncFloorAoeMeshes(this.scene, this.footprints, aoes, time, resolvedIds);
  }

  dispose(): void {
    for (const ring of this.rings.values()) {
      for (const mesh of ring.all) mesh.dispose(false, true);
    }
    this.rings.clear();
    disposeFloorAoeMeshes(this.footprints);
  }
}
