import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

const EMISSIVE_SCALE = 0.6;

export function createLine(scene: Scene, name: string, path: Vector3[], color: Color3, radius: number): Mesh {
  const material = new StandardMaterial(`${name}-mat`, scene);
  material.diffuseColor = color;
  material.emissiveColor = color.scale(EMISSIVE_SCALE);
  material.specularColor = new Color3(0.05, 0.05, 0.05);
  const line = CreateTube(name, {
    updatable: true,
    path,
    radius,
    tessellation: 8,
    cap: BabylonMesh.CAP_ALL,
  }, scene);
  line.material = material;
  line.isPickable = false;
  return line;
}

export function updateLine(line: Mesh, path: Vector3[]): void {
  CreateTube(line.name, { path, instance: line });
}

export function setLineColor(line: Mesh, color: Color3): void {
  const material = line.material as StandardMaterial;
  material.diffuseColor = color;
  material.emissiveColor = color.scale(EMISSIVE_SCALE);
}
