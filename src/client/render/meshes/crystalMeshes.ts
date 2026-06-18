import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder.pure";
import type { Scene } from "@babylonjs/core/scene";
import type { Crystal, CrystalElement } from "@shared/types";

const CRYSTAL_COLORS: Record<CrystalElement, Color3> = {
  wind: new Color3(0.25, 0.9, 0.45),
  fire: new Color3(0.95, 0.2, 0.15),
  water: new Color3(0.2, 0.5, 1),
};

export function createCrystalMesh(scene: Scene, crystal: Crystal): Mesh {
  const mesh = CreatePolyhedron(`crystal-${crystal.element}`, { type: 1, size: 2.2 }, scene);
  mesh.position = new Vector3(crystal.pos.x, 1.35, crystal.pos.z);
  mesh.scaling.y = 1.45;
  mesh.rotation.y = Math.PI / 4;
  mesh.isPickable = false;

  const color = CRYSTAL_COLORS[crystal.element];
  const material = new StandardMaterial(`crystal-mat-${crystal.element}`, scene);
  material.diffuseColor = color;
  material.emissiveColor = color.scale(0.45);
  material.specularColor = Color3.White().scale(0.25);
  material.alpha = 0.88;
  mesh.material = material;

  return mesh;
}
