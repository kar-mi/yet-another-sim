import type { Scene } from "@babylonjs/core/scene";
import type { ActiveMechanic } from "@shared/types";
import { syncFloorAoeMeshes, disposeFloorAoeMeshes, type FloorAoeMeshMap } from "./floorAoeSync";

export class TelegraphLayer {
  private meshes: FloorAoeMeshMap = new Map();

  constructor(private scene: Scene) {}

  sync(mechanics: ActiveMechanic[], time: number): void {
    const aoes = mechanics.filter(m => m.floorAoe).map(m => m.floorAoe!);
    const resolvedIds = new Set(mechanics.filter(m => m.resolved).map(m => m.id));
    syncFloorAoeMeshes(this.scene, this.meshes, aoes, time, resolvedIds);
  }

  dispose(): void {
    disposeFloorAoeMeshes(this.meshes);
  }
}
