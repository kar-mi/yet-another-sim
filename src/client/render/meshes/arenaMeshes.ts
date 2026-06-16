import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { ZoneShape, FloorPlan } from "@shared/types";
import { logger } from "@shared/logger";

// Floor-plan enum value -> top-down arena image. "squares" uses the default crosshatch (no image).
const FLOOR_PLAN_IMAGES: Record<Exclude<FloorPlan, "squares">, string> = {
  "dmu-p1": "/static/arena_raid_imgs/dmu/p1-cropped.png",
  "dmu-p2": "/static/arena_raid_imgs/dmu/p2-cropped.png",
};

export function createZoneMesh(scene: Scene, zone: ZoneShape, floorPlan: FloorPlan): Mesh | null {
  if (zone.kind === "circle" && floorPlan !== "squares") {
    return createFloorPlanCircle(scene, zone, FLOOR_PLAN_IMAGES[floorPlan]);
  }

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

// A circle floor that shows a top-down image on its upper face. The cylinder body is solid black
// (its sides read as a black drum) and a thin textured disc sits on top carrying the floor plan.
function createFloorPlanCircle(scene: Scene, zone: Extract<ZoneShape, { kind: "circle" }>, imageUrl: string): Mesh {
  const thickness = 0.5;
  const body = CreateCylinder("floor", {
    diameter: zone.radius * 2,
    height: thickness,
    tessellation: 64,
  }, scene);
  body.position.set(zone.center.x, -thickness / 2, zone.center.z);

  const blackMat = new StandardMaterial("floor-black-mat", scene);
  blackMat.diffuseColor = new Color3(0, 0, 0);
  blackMat.emissiveColor = new Color3(0, 0, 0);
  blackMat.specularColor = new Color3(0, 0, 0);
  body.material = blackMat;

  // Disc lies in the XY plane facing +Z; rotate it flat so it faces up, just above the top face.
  const top = CreateDisc("floor-plan", { radius: zone.radius, tessellation: 64 }, scene);
  top.parent = body; // local-space child; disposed with the body via mesh.dispose(false, true)
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, thickness / 2 + 0.01, 0);

  const imageMat = new StandardMaterial("floor-plan-mat", scene);
  const tex = new Texture(imageUrl, scene);
  imageMat.diffuseTexture = tex;
  imageMat.emissiveTexture = tex; // self-lit so the plan reads clearly under the dim scene light
  imageMat.specularColor = new Color3(0, 0, 0);
  imageMat.backFaceCulling = false; // disc is single-sided; show it whichever way it ends up facing
  top.material = imageMat;
  return body;
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
