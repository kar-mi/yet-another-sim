import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Crystal } from "@shared/types";
import { createCrystalMesh } from "./meshes/crystalMeshes";

export class CrystalLayer {
  private meshes: { mesh: Mesh; spawnAt: number }[] = [];
  private key = "";

  constructor(private scene: Scene) {}

  sync(crystals: Crystal[], time: number, key: string): void {
    if (key !== this.key) {
      this.key = key;
      for (const { mesh } of this.meshes) mesh.dispose(false, true);
      this.meshes = crystals.map(crystal => ({
        mesh: createCrystalMesh(this.scene, crystal),
        spawnAt: crystal.spawnAt,
      }));
    }

    for (const entry of this.meshes) {
      entry.mesh.setEnabled(time >= entry.spawnAt);
    }
  }

  dispose(): void {
    for (const { mesh } of this.meshes) mesh.dispose(false, true);
    this.meshes = [];
  }
}
