import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveMechanic } from "@shared/types";
import { createTelegraphMesh } from "./meshes/telegraphMeshes";

// Default just-in-time flash color (light blue), shared with the inverse rects.
const DEFAULT_FLASH_COLOR = new Color3(0.4, 0.6, 1);

// True while a flashBeforeResolve mechanic is in its final pre-hit window (and not yet resolved).
function inFlash(m: ActiveMechanic, time: number): boolean {
  return m.flashBeforeResolve != null
    && !m.resolved
    && time >= m.resolveAt - m.flashBeforeResolve.lead;
}

export class TelegraphLayer {
  private meshes = new Map<string, Mesh>();

  constructor(private scene: Scene) {}

  sync(mechanics: ActiveMechanic[], time: number): void {
    // A targeting cast picks its location at resolve time, so its ground circle stays hidden
    // until then. Treat it as inactive while casting so no placeholder mesh is created.
    // showTelegraph === false hides the ground marker entirely (cast bar + damage still apply).
    // telegraphMode === "resolve" suppresses the cast marker but keeps the resolved flash.
    // flashBeforeResolve mechanics draw only during their final pre-hit window, even when
    // showTelegraph is false.
    const visible = mechanics.filter(m =>
      !(m.targeting && !m.resolved)
      && (
        inFlash(m, time)
        || (m.showTelegraph && (m.telegraphMode !== "resolve" || m.resolved))
      )
    );
    const activeIds = new Set(visible.map(m => m.id));
    for (const [id, mesh] of this.meshes) {
      if (!activeIds.has(id)) {
        mesh.dispose(false, true);
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
      if (inFlash(mechanic, time)) {
        const hex = mechanic.flashBeforeResolve!.color;
        const color = hex ? Color3.FromHexString(hex) : DEFAULT_FLASH_COLOR;
        // Self-light the flash (emissive) and keep it mostly opaque so the hue reads true instead of
        // washing toward the bright floor color through the alpha blend.
        mat.diffuseColor.copyFrom(color);
        mat.emissiveColor.copyFrom(color);
        mat.alpha = 0.85;
      } else if (mechanic.resolved) {
        mat.diffuseColor.set(1, 1, 1);
        mat.emissiveColor.set(0, 0, 0);
        mat.alpha = 0.8;
      } else {
        const span = mechanic.resolveAt - mechanic.telegraphStart;
        const progress = span > 0 ? (time - mechanic.telegraphStart) / span : 1;
        mat.diffuseColor.set(1, Math.max(0, 0.8 - progress * 0.6), 0);
        mat.emissiveColor.set(0, 0, 0);
        mat.alpha = 0.25 + progress * 0.45;
      }
    }
  }
}
