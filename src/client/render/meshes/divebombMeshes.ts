import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveDivebomb } from "@shared/types";
import { DIVEBOMB_LINGER } from "@shared/constants";
import { divebombPosition } from "@shared/divebomb";

export type DivebombMeshes = {
  all: Mesh[];
  material: StandardMaterial;
};

export function createDivebombMeshes(scene: Scene, divebomb: ActiveDivebomb): DivebombMeshes {
  const material = new StandardMaterial(`divebomb-mat-${divebomb.id}`, scene);
  const color = Color3.FromHexString(divebomb.color);
  material.diffuseColor = color;
  material.emissiveColor = color.scale(0.5);
  material.specularColor = new Color3(0, 0, 0);
  material.alpha = 0.8;

  const sphere = CreateSphere(
    `divebomb-${divebomb.id}`,
    { diameter: divebomb.size, segments: 16 },
    scene,
  );
  sphere.material = material;
  sphere.isPickable = false;
  return { all: [sphere], material };
}

export function updateDivebombMeshes(handle: DivebombMeshes, divebomb: ActiveDivebomb, time: number): void {
  const position = divebombPosition(
    divebomb.from,
    divebomb.to,
    divebomb.gap,
    divebomb.speed,
    time - divebomb.startedAt,
  );
  // Center the sphere on the floor plane so its lower half bisects the ground.
  handle.all[0]!.position.set(position.x, 0, position.z);
  handle.material.alpha = divebomb.resolved
    ? 0.8 * Math.max(0, 1 - (time - divebomb.expireAt) / DIVEBOMB_LINGER)
    : 0.8;
}
