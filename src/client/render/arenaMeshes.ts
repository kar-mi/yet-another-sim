import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { ZoneShape } from "../../shared/types";
import { logger } from "../../shared/logger";

export function createZoneMesh(scene: Scene, zone: ZoneShape): Mesh | null {
  const mat = new StandardMaterial("floor-mat", scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.emissiveColor = new Color3(0.04, 0.04, 0.05);
  mat.specularColor = new Color3(0, 0, 0);
  const tex = createCrosshatchTexture(scene);
  mat.diffuseTexture = tex;

  const tileWorld = 4;

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
      const span = (zone.radius * 2) / tileWorld;
      tex.uScale = span;
      tex.vScale = span;
      break;
    }
    case "rect":
      mesh = CreateGround("floor", { width: zone.width, height: zone.height }, scene);
      mesh.position.set(zone.center.x, 0, zone.center.z);
      tex.uScale = zone.width / tileWorld;
      tex.vScale = zone.height / tileWorld;
      break;
    case "polygon":
      logger.warn("render", "polygon arena zones are not yet rendered");
      return null;
  }
  mesh.material = mat;
  return mesh;
}

function createCrosshatchTexture(scene: Scene): DynamicTexture {
  const size = 256;
  const tex = new DynamicTexture("floor-crosshatch", size, scene, false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  const ctx = tex.getContext();
  ctx.fillStyle = "rgb(51, 51, 64)";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgb(92, 96, 122)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, size);
  ctx.moveTo(size, 0);
  ctx.lineTo(0, size);
  ctx.stroke();
  tex.update();
  return tex;
}
