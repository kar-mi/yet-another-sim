import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
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

const FLOOR_Y = 0.06;
const SIZE = 1.6;
const isLetter = (mark: WaymarkId) => mark >= "A" && mark <= "D";

export function createWaymarkMeshes(scene: Scene, waymark: Waymark): Mesh[] {
  const color = WAYMARK_COLORS[waymark.mark];
  const { x, z } = waymark.pos;

  // Empty outlined shape on the floor: ring for letters, square border for numbers.
  const path = isLetter(waymark.mark) ? circlePath(x, z) : squarePath(x, z);
  const floor = CreateTube(`wm-${waymark.mark}`, {
    path,
    radius: 0.09,
    tessellation: 8,
    cap: BabylonMesh.CAP_ALL,
  }, scene);
  const floorMat = new StandardMaterial(`wm-mat-${waymark.mark}`, scene);
  floorMat.diffuseColor = color;
  floorMat.emissiveColor = color.scale(0.6);
  floorMat.specularColor = new Color3(0, 0, 0);
  floorMat.alpha = 0.45;
  floor.material = floorMat;

  // Floating glyph that always faces the camera — colored character, no background.
  const label = CreatePlane(`wm-label-${waymark.mark}`, { size: 2 }, scene);
  label.position.set(x, 2.5, z);
  label.billboardMode = BabylonMesh.BILLBOARDMODE_ALL;
  const tex = createLabelTexture(scene, waymark.mark, color);
  const labelMat = new StandardMaterial(`wm-label-mat-${waymark.mark}`, scene);
  // Glyph color is baked into the texture; everything around it is transparent.
  labelMat.diffuseTexture = tex;
  labelMat.useAlphaFromDiffuseTexture = true;
  labelMat.emissiveTexture = tex;
  labelMat.emissiveColor = new Color3(1, 1, 1);
  labelMat.diffuseColor = new Color3(0, 0, 0);
  labelMat.specularColor = new Color3(0, 0, 0);
  labelMat.alpha = 0.45;
  labelMat.backFaceCulling = false;
  label.material = labelMat;

  return [floor, label];
}

function circlePath(cx: number, cz: number): Vector3[] {
  const seg = 48;
  const pts: Vector3[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push(new Vector3(cx + Math.cos(a) * SIZE, FLOOR_Y, cz + Math.sin(a) * SIZE));
  }
  return pts;
}

function squarePath(cx: number, cz: number): Vector3[] {
  const h = SIZE;
  return [
    new Vector3(cx + h, FLOOR_Y, cz + h),
    new Vector3(cx + h, FLOOR_Y, cz - h),
    new Vector3(cx - h, FLOOR_Y, cz - h),
    new Vector3(cx - h, FLOOR_Y, cz + h),
    new Vector3(cx + h, FLOOR_Y, cz + h),
  ];
}

function createLabelTexture(scene: Scene, mark: WaymarkId, color: Color3): DynamicTexture {
  const tex = new DynamicTexture(`wm-tex-${mark}`, 256, scene, false);
  tex.hasAlpha = true;
  const css = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
  // drawText with a "transparent" clear color yields a real transparent alpha channel,
  // so the plane shows only the glyph (not a black/white quad). x=null centers it.
  tex.drawText(mark, null, 196, "bold 200px sans-serif", css, "transparent", true);
  return tex;
}
