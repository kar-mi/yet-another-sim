import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder.pure";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { Crystal, CrystalElement } from "@shared/types";

const CRYSTAL_COLORS: Record<CrystalElement, Color3> = {
  wind: new Color3(0.25, 0.9, 0.45),
  fire: new Color3(0.95, 0.2, 0.15),
  water: new Color3(0.2, 0.5, 1),
  earth: new Color3(1, 0.9, 0.18),
};

// Per-element shape: water = square (box), fire = triangle (3-sided pyramid with its base flat on
// the floor plane), wind = diamond (octahedron), earth = rock (dodecahedron).
function createShape(scene: Scene, crystal: Crystal): Mesh {
  const name = `crystal-${crystal.element}`;
  switch (crystal.element) {
    case "water":
      return CreateBox(name, { size: 1.6 }, scene);
    case "fire":
      return CreateCylinder(name, { height: 1.8, diameterTop: 0, diameterBottom: 2, tessellation: 3 }, scene);
    case "wind":
      return CreatePolyhedron(name, { type: 1, size: 1.1 }, scene);
    case "earth":
      return CreatePolyhedron(name, { type: 2, size: 1.25 }, scene);
  }
}

export function createCrystalMesh(scene: Scene, crystal: Crystal): Mesh {
  const mesh = createShape(scene, crystal);
  mesh.position = new Vector3(crystal.pos.x, 1.3, crystal.pos.z);
  mesh.scaling.y = 1;
  // Keep the 45° flair for the diamond/triangle; the box stays axis-aligned so it reads as a square.
  if (crystal.element !== "water") mesh.rotation.y = Math.PI / 4;
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
