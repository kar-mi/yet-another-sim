import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveHazard } from "@shared/types";

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
  mat.alpha = 0.85;

  const all = hazard.spots.map((spot, i) => {
    const sphere = CreateSphere(`hazard-${hazard.id}-${i}`, { diameter: hazard.radius * 2, segments: 32 }, scene);
    sphere.position.set(spot.x, hazard.radius, spot.z);
    sphere.isPickable = false;
    sphere.material = mat;
    return sphere;
  });

  return { all, mat };
}

export function updateHazardMeshes(handle: HazardMeshes, hazard: ActiveHazard, time: number): void {
  const remaining = Math.max(0, hazard.expireAt - time);
  handle.mat.alpha = Math.min(0.9, 0.35 + remaining * 0.08);
}
