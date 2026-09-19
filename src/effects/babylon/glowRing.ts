import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

export type GlowRing = { mesh: Mesh; material: StandardMaterial };

export type GlowRingOptions = {
  diameter: number;
  thickness: number;
  color: Color3;
  tessellation?: number;
  backFaceCulling?: boolean;
};

// Unlit torus that reads at full colour regardless of scene lighting.
export function createGlowRing(scene: Scene, name: string, options: GlowRingOptions): GlowRing {
  const mesh = CreateTorus(name, {
    diameter: options.diameter,
    thickness: options.thickness,
    tessellation: options.tessellation ?? 48,
  }, scene);
  mesh.isPickable = false;
  const material = new StandardMaterial(`${name}-mat`, scene);
  material.diffuseColor = options.color;
  material.emissiveColor = options.color;
  material.specularColor = new Color3(0, 0, 0);
  material.disableLighting = true;
  if (options.backFaceCulling === false) material.backFaceCulling = false;
  mesh.material = material;
  return { mesh, material };
}
