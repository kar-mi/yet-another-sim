import type { Scene } from "@babylonjs/core/scene";
import type { ActiveGaze } from "../../shared/types";
import { createGazeMeshes, updateGazeMeshes, type GazeMeshes } from "./gazeMeshes";

export class GazeLayer {
  private gazes = new Map<string, GazeMeshes>();

  constructor(private scene: Scene) {}

  sync(gazes: ActiveGaze[], time: number): void {
    const activeIds = new Set(gazes.map(g => g.id));
    for (const [id, handle] of this.gazes) {
      if (!activeIds.has(id)) {
        for (const mesh of handle.all) mesh.dispose(false, true);
        this.gazes.delete(id);
      }
    }

    for (const gz of gazes) {
      let handle = this.gazes.get(gz.id);
      if (!handle) {
        handle = createGazeMeshes(this.scene, gz);
        this.gazes.set(gz.id, handle);
      }
      updateGazeMeshes(handle, gz, time);
    }
  }

  dispose(): void {
    for (const handle of this.gazes.values()) {
      for (const mesh of handle.all) mesh.dispose(false, true);
    }
    this.gazes.clear();
  }
}
