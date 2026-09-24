import type { Scene } from "@babylonjs/core/scene";
import type { ActiveInverse, Boss } from "@shared/types";
import { createQuestionRingForInverse, updateQuestionRingForInverse } from "./meshes/inverseMeshes";
import { syncFloorTelegraphs, disposeFloorTelegraphs, type FloorTelegraphMap } from "@effects/babylon";
import { KeyedMeshLayer } from "./KeyedMeshLayer";

export class InverseLayer {
  private rings;
  private footprints: FloorTelegraphMap = new Map();

  constructor(private scene: Scene) {
    this.rings = new KeyedMeshLayer(scene, createQuestionRingForInverse);
  }

  sync(inversions: ActiveInverse[], boss: Boss, time: number): void {
    this.rings.sync(inversions, (ring, inv) => updateQuestionRingForInverse(ring, inv, boss, time));

    // Shown-shape telegraph footprints are always drawn; hidden shapes are intentionally not rendered.
    const aoes = inversions.flatMap(inv => inv.floorAoes ?? []);
    const resolvedIds = new Set(inversions.filter(inv => inv.resolved).flatMap(inv => (inv.floorAoes ?? []).map(a => a.id)));
    syncFloorTelegraphs(this.scene, this.footprints, aoes, time, resolvedIds);
  }

  dispose(): void {
    this.rings.dispose();
    disposeFloorTelegraphs(this.footprints);
  }
}
