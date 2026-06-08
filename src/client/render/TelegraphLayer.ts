import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveMechanic } from "../../shared/types";
import { createTelegraphMesh } from "./meshes/telegraphMeshes";

export class TelegraphLayer {
  private meshes = new Map<string, Mesh>();

  constructor(private scene: Scene) {}

  sync(mechanics: ActiveMechanic[], time: number): void {
    // A targeting cast picks its location at resolve time, so its ground circle stays hidden
    // until then. Treat it as inactive while casting so no placeholder mesh is created.
    // showTelegraph === false hides the ground marker entirely (cast bar + damage still apply).
    const visible = mechanics.filter(m => m.showTelegraph && !(m.targeting && !m.resolved));
    const activeIds = new Set(visible.map(m => m.id));
    for (const [id, mesh] of this.meshes) {
      if (!activeIds.has(id)) {
        mesh.dispose();
        this.meshes.delete(id);
      }
    }

    for (const mechanic of visible) {
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
