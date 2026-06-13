import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Waymark } from "@shared/types";
import { createWaymarkMeshes } from "./meshes/waymarkMeshes";

export class WaymarkLayer {
  private meshes: Mesh[] = [];
  private key = "";

  constructor(private scene: Scene) {}

  sync(waymarks: Waymark[], key: string): void {
    if (key === this.key) return;
    this.key = key;

    for (const mesh of this.meshes) mesh.dispose(false, true);
    this.meshes = [];
    for (const waymark of waymarks) {
      this.meshes.push(...createWaymarkMeshes(this.scene, waymark));
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose(false, true);
    this.meshes = [];
  }
}
