import type { Scene } from "@babylonjs/core/scene";
import type { ActiveGaze } from "@shared/types";
import { createGazeMeshes, updateGazeMeshes } from "./meshes/gazeMeshes";
import { syncFloorTelegraphs, disposeFloorTelegraphs, type FloorTelegraphMap } from "@effects/babylon";
import { KeyedMeshLayer } from "./KeyedMeshLayer";

export class GazeLayer {
  private gazes;
  private cones: FloorTelegraphMap = new Map();

  constructor(private scene: Scene) {
    this.gazes = new KeyedMeshLayer(scene, createGazeMeshes);
  }

  sync(gazes: ActiveGaze[], time: number): void {
    const visibleGazes = gazes.filter(gaze => !(gaze.carrierId && gaze.reverse));

    // Carrier-cone gazes render as a plain FloorAoe footprint; eye-board gazes keep their own visual.
    const boards = visibleGazes.filter(g => !g.floorAoe);
    this.gazes.sync(boards, (handle, gz) => updateGazeMeshes(handle, gz, time));

    const aoes = visibleGazes.filter(g => g.floorAoe).map(g => g.floorAoe!);
    const resolvedIds = new Set(visibleGazes.filter(g => g.resolved).map(g => g.id));
    syncFloorTelegraphs(this.scene, this.cones, aoes, time, resolvedIds);
  }

  dispose(): void {
    this.gazes.dispose();
    disposeFloorTelegraphs(this.cones);
  }
}
