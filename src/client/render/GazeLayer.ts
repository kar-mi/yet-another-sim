import type { Scene } from "@babylonjs/core/scene";
import type { ActiveGaze } from "@shared/types";
import { createGazeMeshes, updateGazeMeshes, type GazeMeshes } from "./meshes/gazeMeshes";
import { syncFloorAoeMeshes, disposeFloorAoeMeshes, type FloorAoeMeshMap } from "./floorAoeSync";

export class GazeLayer {
  private gazes = new Map<string, GazeMeshes>();
  private cones: FloorAoeMeshMap = new Map();

  constructor(private scene: Scene) {}

  sync(gazes: ActiveGaze[], time: number): void {
    const visibleGazes = gazes.filter(gaze => !(gaze.carrierId && gaze.reverse));

    // Carrier-cone gazes render as a plain FloorAoe footprint; eye-board gazes keep their own visual.
    const boards = visibleGazes.filter(g => !g.floorAoe);
    const activeIds = new Set(boards.map(g => g.id));
    for (const [id, handle] of this.gazes) {
      if (!activeIds.has(id)) {
        for (const mesh of handle.all) mesh.dispose(false, true);
        this.gazes.delete(id);
      }
    }
    for (const gz of boards) {
      let handle = this.gazes.get(gz.id);
      if (!handle) {
        handle = createGazeMeshes(this.scene, gz);
        this.gazes.set(gz.id, handle);
      }
      updateGazeMeshes(handle, gz, time);
    }

    const aoes = visibleGazes.filter(g => g.floorAoe).map(g => g.floorAoe!);
    const resolvedIds = new Set(visibleGazes.filter(g => g.resolved).map(g => g.id));
    syncFloorAoeMeshes(this.scene, this.cones, aoes, time, resolvedIds);
  }

  dispose(): void {
    for (const handle of this.gazes.values()) {
      for (const mesh of handle.all) mesh.dispose(false, true);
    }
    this.gazes.clear();
    disposeFloorAoeMeshes(this.cones);
  }
}
