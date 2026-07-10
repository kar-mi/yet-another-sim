import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { FloorAoe } from "@shared/floorAoe";
import { isFloorAoeVisible } from "@shared/floorAoe";
import { createShapeMesh } from "./meshes/telegraphMeshes";

const DEFAULT_ALPHA = 0.5;

type FloorAoeMeshEntry = { mesh: Mesh; source: FloorAoe };
export type FloorAoeMeshMap = Map<string, FloorAoeMeshEntry>;

// Generic mesh lifecycle (create/update/dispose, keyed by FloorAoe.id) shared by every layer that
// draws a floor telegraph. This is the one place a FloorAoe's geometry + color/alpha get turned
// into a Babylon mesh, replacing the bespoke per-layer coloring each render layer used to do.
export function syncFloorAoeMeshes(
  scene: Scene,
  meshes: FloorAoeMeshMap,
  aoes: FloorAoe[],
  time: number,
  resolvedIds: ReadonlySet<string>,
): void {
  const visible = aoes.filter(aoe => isFloorAoeVisible(aoe, time, resolvedIds.has(aoe.id)));
  const visibleIds = new Set(visible.map(aoe => aoe.id));

  for (const [id, entry] of meshes) {
    if (!visibleIds.has(id)) {
      entry.mesh.dispose(false, true);
      meshes.delete(id);
    }
  }

  for (const aoe of visible) {
    let entry = meshes.get(aoe.id);
    // FloorAoe is immutable; a new instance under the same id means the shape (or something else)
    // changed, e.g. a targeting cast resolving its center. Rebuild the mesh rather than reposition it.
    if (entry && entry.source !== aoe) {
      entry.mesh.dispose(false, true);
      entry = undefined;
    }
    if (!entry) {
      const mesh = createShapeMesh(scene, aoe.id, aoe.shape);
      if (!mesh) continue;
      const mat = new StandardMaterial(`floor-aoe-mat-${aoe.id}`, scene);
      mat.specularColor = new Color3(0, 0, 0);
      mat.backFaceCulling = false;
      // Donut ribbons (and any other hand-wound mesh) may face away from the hemispheric light
      // depending on vertex winding; without this the surface lights with groundColor (black)
      // regardless of diffuseColor. Two-sided lighting flips the normal for back-facing polygons.
      mat.twoSidedLighting = true;
      mesh.material = mat;
      entry = { mesh, source: aoe };
      meshes.set(aoe.id, entry);
    }
    const mat = entry.mesh.material as StandardMaterial;
    mat.diffuseColor.copyFrom(Color3.FromHexString(aoe.color));
    mat.alpha = aoe.alpha ?? DEFAULT_ALPHA;
  }
}

export function disposeFloorAoeMeshes(meshes: FloorAoeMeshMap): void {
  for (const entry of meshes.values()) entry.mesh.dispose(false, true);
  meshes.clear();
}
