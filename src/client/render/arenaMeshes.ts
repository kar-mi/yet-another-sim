import {
  Color3, Mesh, MeshBuilder, Scene, StandardMaterial,
} from "@babylonjs/core";
import type { ZoneShape } from "../../shared/types";

export function createZoneMesh(scene: Scene, zone: ZoneShape): Mesh | null {
  const mat = new StandardMaterial("floor-mat", scene);
  mat.diffuseColor = new Color3(0.2, 0.2, 0.25);
  mat.emissiveColor = new Color3(0.08, 0.08, 0.1);
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  mat.specularColor = new Color3(0, 0, 0);

  let mesh: Mesh;
  switch (zone.kind) {
    case "circle": {
      const thickness = 0.5;
      mesh = MeshBuilder.CreateCylinder("floor", {
        diameter: zone.radius * 2,
        height: thickness,
        sideOrientation: Mesh.DOUBLESIDE,
        tessellation: 64,
      }, scene);
      mesh.position.set(zone.center.x, -thickness / 2, zone.center.z);
      break;
    }
    case "rect":
      mesh = MeshBuilder.CreateGround("floor", { width: zone.width, height: zone.height }, scene);
      mesh.position.set(zone.center.x, 0, zone.center.z);
      break;
    case "polygon":
      console.warn("Polygon arena zones are not yet rendered");
      return null;
  }
  mesh.material = mat;
  return mesh;
}
