import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

export type GroundCircle = { mesh: Mesh; material: StandardMaterial };

export type GroundCircleOptions = {
  radius: number;
  y: number;
  color: Color3;
  alpha: number;
  emissive?: Color3;
  tessellation?: number;
};

export function createGroundCircle(scene: Scene, name: string, options: GroundCircleOptions): GroundCircle {
  const mesh = CreateDisc(name, { radius: options.radius, tessellation: options.tessellation ?? 48 }, scene);
  mesh.rotation.x = Math.PI / 2;
  mesh.isPickable = false;
  const material = new StandardMaterial(`${name}-mat`, scene);
  material.diffuseColor = options.color;
  if (options.emissive) material.emissiveColor = options.emissive;
  material.specularColor = new Color3(0, 0, 0);
  material.alpha = options.alpha;
  material.backFaceCulling = false;
  mesh.material = material;
  return { mesh, material };
}

export function disposeGroundCircle(circle: GroundCircle): void {
  circle.mesh.dispose(false, true);
}
