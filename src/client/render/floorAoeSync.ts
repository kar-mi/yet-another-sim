import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { FloorAoe } from "@shared/floorAoe";
import { isFloorAoeVisible } from "@shared/floorAoe";
import { createShapeMesh, createShapeOutlineMesh } from "./meshes/telegraphMeshes";
import { elementFloorMaterial } from "./elementVfx";

const DEFAULT_ALPHA = 0.5;
const OUTLINE_ALPHA = 0.95;
// Faint floor tint drawn under an outline in the same color.
const OUTLINE_FILL_ALPHA = 0.15;

type FloorAoeMeshEntry = { mesh: Mesh; outline: boolean; fill?: Mesh; source: FloorAoe };

export function createFloorMaterial(scene: Scene, name: string): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  // Light both faces so reversed winding does not black out donut ribbons.
  mat.twoSidedLighting = true;
  return mat;
}
export type FloorAoeMeshMap = Map<string, FloorAoeMeshEntry>;

function disposeEntry(entry: FloorAoeMeshEntry): void {
  if (!entry.source.element) {
    entry.mesh.dispose(false, true);
    return;
  }
  // Element materials are shared across AoEs; only an outline's own material is freed.
  entry.fill?.dispose(false, false);
  entry.mesh.dispose(false, entry.outline);
}

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
      disposeEntry(entry);
      meshes.delete(id);
    }
  }

  for (const aoe of visible) {
    let entry = meshes.get(aoe.id);
    // FloorAoe is immutable; a new instance under the same id means the shape (or something else)
    // changed, e.g. a targeting cast resolving its center. Rebuild the mesh rather than reposition it.
    if (entry && entry.source !== aoe) {
      disposeEntry(entry);
      entry = undefined;
    }
    if (!entry) {
      const outline = aoe.style === "outline" ? createShapeOutlineMesh(scene, aoe.id, aoe.shape) : null;
      const mesh = outline ?? createShapeMesh(scene, aoe.id, aoe.shape);
      if (!mesh) continue;
      mesh.material = aoe.element && !outline
        ? elementFloorMaterial(scene, aoe.element, aoe.color, aoe.alpha ?? DEFAULT_ALPHA)
        : createFloorMaterial(scene, `floor-aoe-mat-${aoe.id}`);
      entry = { mesh, outline: outline !== null, source: aoe };
      if (outline) {
        // Dispose the fill with the outline.
        const fill = createShapeMesh(scene, `${aoe.id}-fill`, aoe.shape);
        if (fill) {
          fill.material = aoe.element
            ? elementFloorMaterial(scene, aoe.element, aoe.color, OUTLINE_FILL_ALPHA)
            : createFloorMaterial(scene, `floor-aoe-fill-mat-${aoe.id}`);
          fill.parent = mesh;
          entry.fill = fill;
        }
      }
      meshes.set(aoe.id, entry);
    }
    // Element materials bake color/alpha in at creation (FloorAoe is immutable).
    if (aoe.element && !entry.outline) continue;
    const mat = entry.mesh.material as StandardMaterial;
    mat.diffuseColor.copyFrom(Color3.FromHexString(aoe.color));
    // Keep outlines bright regardless of lighting.
    if (entry.outline) mat.emissiveColor.copyFrom(mat.diffuseColor);
    mat.alpha = aoe.alpha ?? (entry.outline ? OUTLINE_ALPHA : DEFAULT_ALPHA);
    if (entry.fill && !aoe.element) {
      const fillMat = entry.fill.material as StandardMaterial;
      fillMat.diffuseColor.copyFrom(mat.diffuseColor);
      fillMat.alpha = OUTLINE_FILL_ALPHA;
    }
  }
}

export function disposeFloorAoeMeshes(meshes: FloorAoeMeshMap): void {
  for (const entry of meshes.values()) disposeEntry(entry);
  meshes.clear();
}
