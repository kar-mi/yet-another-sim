import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { Waymark, WaymarkId } from "../../shared/types";

// FFXIV waymark convention: letter/number pairs share a color.
// A/1 red, B/2 yellow, C/3 blue, D/4 purple.
const WAYMARK_COLORS: Record<WaymarkId, Color3> = {
  A: new Color3(0.95, 0.25, 0.25), "1": new Color3(0.95, 0.25, 0.25),
  B: new Color3(0.95, 0.8, 0.2), "2": new Color3(0.95, 0.8, 0.2),
  C: new Color3(0.3, 0.55, 0.95), "3": new Color3(0.3, 0.55, 0.95),
  D: new Color3(0.7, 0.35, 0.9), "4": new Color3(0.7, 0.35, 0.9),
};

const isLetter = (mark: WaymarkId) => mark >= "A" && mark <= "D";

export function createWaymarkMeshes(scene: Scene, waymark: Waymark): Mesh[] {
  const color = WAYMARK_COLORS[waymark.mark];
  const { x, z } = waymark.pos;

  // Flat translucent shape on the floor: circle for letters, square for numbers.
  const floor = isLetter(waymark.mark)
    ? CreateDisc(`wm-${waymark.mark}`, { radius: 1.6, tessellation: 48 }, scene)
    : CreateGround(`wm-${waymark.mark}`, { width: 3.2, height: 3.2 }, scene);
  if (isLetter(waymark.mark)) floor.rotation.x = Math.PI / 2;
  floor.position.set(x, 0.02, z);
  const floorMat = new StandardMaterial(`wm-mat-${waymark.mark}`, scene);
  floorMat.diffuseColor = color;
  floorMat.emissiveColor = color.scale(0.6);
  floorMat.specularColor = new Color3(0, 0, 0);
  floorMat.alpha = 0.35;
  floorMat.backFaceCulling = false;
  floor.material = floorMat;

  // Floating translucent label that always faces the camera.
  const label = CreatePlane(`wm-label-${waymark.mark}`, { size: 2 }, scene);
  label.position.set(x, 2.5, z);
  label.billboardMode = BabylonMesh.BILLBOARDMODE_ALL;
  const labelMat = new StandardMaterial(`wm-label-mat-${waymark.mark}`, scene);
  labelMat.diffuseTexture = createLabelTexture(scene, waymark.mark);
  labelMat.diffuseTexture.hasAlpha = true;
  labelMat.useAlphaFromDiffuseTexture = true;
  labelMat.diffuseColor = new Color3(0, 0, 0);
  labelMat.emissiveColor = color;
  labelMat.specularColor = new Color3(0, 0, 0);
  labelMat.alpha = 0.75;
  labelMat.backFaceCulling = false;
  label.material = labelMat;

  return [floor, label];
}

function createLabelTexture(scene: Scene, mark: WaymarkId): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture(`wm-tex-${mark}`, size, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "white";
  ctx.font = "bold 200px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(mark, size / 2, size / 2);
  tex.update(true);
  return tex;
}
