import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ZoneShape } from "../../shared/types";

export function createZoneMesh(scene: Scene, zone: ZoneShape): Mesh | null {
  const mat = new StandardMaterial("floor-mat", scene);
  mat.diffuseColor = new Color3(0.2, 0.2, 0.25);
  mat.emissiveColor = new Color3(0.08, 0.08, 0.1);
  mat.specularColor = new Color3(0, 0, 0);

  let mesh: Mesh;
  switch (zone.kind) {
    case "circle": {
      const thickness = 0.5;
      mesh = CreateCylinder("floor", {
        diameter: zone.radius * 2,
        height: thickness,
        tessellation: 64,
      }, scene);
      mesh.position.set(zone.center.x, -thickness / 2, zone.center.z);
      break;
    }
    case "rect":
      mesh = CreateGround("floor", { width: zone.width, height: zone.height }, scene);
      mesh.position.set(zone.center.x, 0, zone.center.z);
      break;
    case "polygon":
      console.warn("Polygon arena zones are not yet rendered");
      return null;
  }
  mesh.material = mat;
  return mesh;
}
