import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveHazard } from "@shared/types";

const Y = 0.025;
const HAZARD_COLOR = new Color3(0.05, 0.02, 0.08);

export type HazardMeshes = {
  all: Mesh[];
  mat: StandardMaterial;
};

export function createHazardMeshes(scene: Scene, hazard: ActiveHazard): HazardMeshes {
  const mat = new StandardMaterial(`hazard-mat-${hazard.id}`, scene);
  mat.diffuseColor = HAZARD_COLOR;
  mat.emissiveColor = new Color3(0.4, 0.1, 0.8);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  mat.alpha = 0.4;

  const all = hazard.spots.map((spot, i) => {
    const disc = CreateDisc(`hazard-${hazard.id}-${i}`, { radius: hazard.radius, tessellation: 64 }, scene);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(spot.x, Y, spot.z);
    disc.isPickable = false;
    disc.material = mat;
    return disc;
  });

  return { all, mat };
}

export function updateHazardMeshes(handle: HazardMeshes, hazard: ActiveHazard, time: number): void {
  const remaining = Math.max(0, hazard.expireAt - time);
  handle.mat.alpha = Math.min(0.45, 0.2 + remaining * 0.08);
}
