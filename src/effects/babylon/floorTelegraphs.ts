import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { FloorAoe } from "../index";
import { isFloorAoeVisible } from "../index";
import { createShapeMesh, createShapeOutlineMesh } from "./shapeGeometry";
import { elementFloorMaterial } from "./elementVfx";

const DEFAULT_ALPHA = 0.5;
const OUTLINE_ALPHA = 0.95;
const OUTLINE_FILL_ALPHA = 0.15;

type FloorTelegraphEntry = { mesh: Mesh; outline: boolean; fill?: Mesh; source: FloorAoe };

export function createFloorTelegraphMaterial(scene: Scene, name: string): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  return mat;
}
export type FloorTelegraphMap = Map<string, FloorTelegraphEntry>;

function patternElement(aoe: FloorAoe): FloorAoe["element"] {
  return aoe.vfx?.floor?.element === false ? undefined : aoe.element;
}

function patternAlpha(aoe: FloorAoe, base: number): number {
  return base * (aoe.vfx?.floor?.intensity ?? 1);
}

function disposeEntry(entry: FloorTelegraphEntry): void {
  if (!patternElement(entry.source)) {
    entry.mesh.dispose(false, true);
    return;
  }
  entry.fill?.dispose(false, false);
  entry.mesh.dispose(false, entry.outline);
}

export function syncFloorTelegraphs(
  scene: Scene,
  meshes: FloorTelegraphMap,
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
    if (entry && entry.source !== aoe) {
      disposeEntry(entry);
      entry = undefined;
    }
    if (!entry) {
      const element = patternElement(aoe);
      const outline = aoe.style === "outline" ? createShapeOutlineMesh(scene, aoe.id, aoe.shape) : null;
      const mesh = outline ?? createShapeMesh(scene, aoe.id, aoe.shape);
      if (!mesh) continue;
      mesh.material = element && !outline
        ? elementFloorMaterial(scene, element, aoe.color, patternAlpha(aoe, aoe.alpha ?? DEFAULT_ALPHA))
        : createFloorTelegraphMaterial(scene, `floor-telegraph-mat-${aoe.id}`);
      entry = { mesh, outline: outline !== null, source: aoe };
      if (outline) {
        const fill = createShapeMesh(scene, `${aoe.id}-fill`, aoe.shape);
        if (fill) {
          fill.material = element
            ? elementFloorMaterial(scene, element, aoe.color, patternAlpha(aoe, OUTLINE_FILL_ALPHA))
            : createFloorTelegraphMaterial(scene, `floor-telegraph-fill-mat-${aoe.id}`);
          fill.parent = mesh;
          entry.fill = fill;
        }
      }
      meshes.set(aoe.id, entry);
    }
    if (patternElement(aoe) && !entry.outline) continue;
    const mat = entry.mesh.material as StandardMaterial;
    mat.diffuseColor.copyFrom(Color3.FromHexString(aoe.color));
    if (entry.outline) mat.emissiveColor.copyFrom(mat.diffuseColor);
    mat.alpha = aoe.alpha ?? (entry.outline ? OUTLINE_ALPHA : DEFAULT_ALPHA);
    if (entry.fill && !patternElement(aoe)) {
      const fillMat = entry.fill.material as StandardMaterial;
      fillMat.diffuseColor.copyFrom(mat.diffuseColor);
      fillMat.alpha = OUTLINE_FILL_ALPHA;
    }
  }
}

export function disposeFloorTelegraphs(meshes: FloorTelegraphMap): void {
  for (const entry of meshes.values()) disposeEntry(entry);
  meshes.clear();
}
