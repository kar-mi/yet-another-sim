import { Color3, Mesh, Scene, StandardMaterial } from "@babylonjs/core";
import type { ActiveMechanic } from "../../shared/types";
import { createTelegraphMesh } from "./telegraphMeshes";

export class TelegraphLayer {
  private meshes = new Map<string, Mesh>();

  constructor(private scene: Scene) {}

  sync(mechanics: ActiveMechanic[], time: number): void {
    const activeIds = new Set(mechanics.map(m => m.id));
    for (const [id, mesh] of this.meshes) {
      if (!activeIds.has(id)) {
        mesh.dispose();
        this.meshes.delete(id);
      }
    }

    for (const mechanic of mechanics) {
      if (!this.meshes.has(mechanic.id)) {
        const mesh = createTelegraphMesh(this.scene, mechanic);
        if (mesh) this.meshes.set(mechanic.id, mesh);
      }
      const mesh = this.meshes.get(mechanic.id);
      if (!mesh) continue;
      const mat = mesh.material as StandardMaterial;
      if (mechanic.resolved) {
        mat.diffuseColor = new Color3(1, 1, 1);
        mat.alpha = 0.8;
      } else {
        const span = mechanic.resolveAt - mechanic.telegraphStart;
        const progress = span > 0 ? (time - mechanic.telegraphStart) / span : 1;
        mat.diffuseColor = new Color3(1, Math.max(0, 0.8 - progress * 0.6), 0);
        mat.alpha = 0.25 + progress * 0.45;
      }
    }
  }
}
