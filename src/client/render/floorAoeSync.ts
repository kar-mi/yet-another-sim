import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { FloorAoe } from "@shared/floorAoe";
import { isFloorAoeVisible } from "@shared/floorAoe";
import { createShapeMesh, createShapeOutlineMesh } from "./meshes/telegraphMeshes";

const DEFAULT_ALPHA = 0.5;
const OUTLINE_ALPHA = 0.95;
// Faint floor tint drawn under an outline in the same color.
const OUTLINE_FILL_ALPHA = 0.15;

type FloorAoeMeshEntry = { mesh: Mesh; fill?: Mesh; source: FloorAoe };

function createFloorMaterial(scene: Scene, name: string): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  // Light both faces so reversed winding does not black out donut ribbons.
  mat.twoSidedLighting = true;
  return mat;
}
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
      const mesh = aoe.style === "outline"
        ? createShapeOutlineMesh(scene, aoe.id, aoe.shape)
        : createShapeMesh(scene, aoe.id, aoe.shape);
      if (!mesh) continue;
      mesh.material = createFloorMaterial(scene, `floor-aoe-mat-${aoe.id}`);
      entry = { mesh, source: aoe };
      if (aoe.style === "outline") {
        // Dispose the fill with the outline.
        const fill = createShapeMesh(scene, `${aoe.id}-fill`, aoe.shape);
        if (fill) {
          fill.material = createFloorMaterial(scene, `floor-aoe-fill-mat-${aoe.id}`);
          fill.parent = mesh;
          entry.fill = fill;
        }
      }
      meshes.set(aoe.id, entry);
    }
    const mat = entry.mesh.material as StandardMaterial;
    mat.diffuseColor.copyFrom(Color3.FromHexString(aoe.color));
    // Keep outlines bright regardless of lighting.
    if (aoe.style === "outline") mat.emissiveColor.copyFrom(mat.diffuseColor);
    mat.alpha = aoe.alpha ?? (aoe.style === "outline" ? OUTLINE_ALPHA : DEFAULT_ALPHA);
    if (entry.fill) {
      const fillMat = entry.fill.material as StandardMaterial;
      fillMat.diffuseColor.copyFrom(mat.diffuseColor);
      fillMat.alpha = OUTLINE_FILL_ALPHA;
    }
  }
}

export function disposeFloorAoeMeshes(meshes: FloorAoeMeshMap): void {
  for (const entry of meshes.values()) entry.mesh.dispose(false, true);
  meshes.clear();
}
