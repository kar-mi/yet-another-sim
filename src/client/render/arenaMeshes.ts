import {
  Color3, DynamicTexture, Mesh, MeshBuilder, Scene, StandardMaterial,
} from "@babylonjs/core";
import type { ZoneShape } from "../../shared/types";

export function createZoneMesh(scene: Scene, zone: ZoneShape): Mesh | null {
  const mat = new StandardMaterial("floor-mat", scene);
  mat.diffuseColor = new Color3(0.2, 0.2, 0.25);
  mat.specularColor = new Color3(0, 0, 0);

  const showFloorTexture = true;
  if (showFloorTexture && zone.kind === "circle") {
    const texSize = 512;
    const tex = new DynamicTexture("floor-tex", { width: texSize, height: texSize }, scene);
    const ctx = tex.getContext();
    ctx.fillStyle = "#33333f";
    ctx.fillRect(0, 0, texSize, texSize);
    ctx.strokeStyle = "#44445a";
    ctx.lineWidth = 1;
    const step = 32;
    for (let i = 0; i <= texSize; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i, texSize);
      ctx.moveTo(0, i); ctx.lineTo(texSize, i);
      ctx.stroke();
    }
    tex.update();
    mat.diffuseTexture = tex;
  }

  let mesh: Mesh;
  switch (zone.kind) {
    case "circle": {
      const thickness = 0.5;
      mesh = MeshBuilder.CreateCylinder("floor", {
        diameter: zone.radius * 2,
        height: thickness,
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
