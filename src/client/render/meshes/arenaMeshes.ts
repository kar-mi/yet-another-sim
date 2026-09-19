import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { ZoneShape, FloorPlan, ZoneImage } from "@shared/types";
import type { Vec2 } from "@shared/math";
import { logger } from "@shared/logger";
import { STATIC_ROOT } from "../../staticBase";

// Floor-plan enum value -> top-down arena image. "squares" uses the default crosshatch (no image).
export const FLOOR_PLAN_IMAGES: Record<Exclude<Extract<FloorPlan, string>, "squares">, string> = {
  "dmu-p1": `${STATIC_ROOT}/arena_raid_imgs/dmu/p1-cropped.webp`,
  "dmu-p2": `${STATIC_ROOT}/arena_raid_imgs/dmu/p2-cropped.webp`,
};

// Top-down art for textured arena zones.
const ZONE_IMAGES: Record<ZoneImage, string> = {
  "index-trapezoid": `${STATIC_ROOT}/arena_raid_imgs/index/trapezoid.webp`,
  "index-square": `${STATIC_ROOT}/arena_raid_imgs/index/square.webp`,
};

// Project UVs onto local axes to avoid stretching trapezoid textures.
function createQuad(scene: Scene, vertices: Vec2[]): Mesh {
  const [a, b, c, d] = vertices as [Vec2, Vec2, Vec2, Vec2];
  const axis = { x: (c.x + d.x) / 2 - (a.x + b.x) / 2, z: (c.z + d.z) / 2 - (a.z + b.z) / 2 };
  const len = Math.hypot(axis.x, axis.z) || 1;
  const along = { x: axis.x / len, z: axis.z / len };
  const side = { x: along.z, z: -along.x };

  const us = vertices.map(p => p.x * side.x + p.z * side.z);
  const vs = vertices.map(p => p.x * along.x + p.z * along.z);
  const uMin = Math.min(...us), uSpan = Math.max(...us) - uMin;
  const vMin = Math.min(...vs), vSpan = Math.max(...vs) - vMin;

  const data = new VertexData();
  data.positions = vertices.flatMap(p => [p.x, 0, p.z]);
  // Invert v to align the art’s narrow end with the trapezoid’s near edge.
  data.uvs = vertices.flatMap((_, i) => [(us[i]! - uMin) / uSpan, 1 - (vs[i]! - vMin) / vSpan]);
  data.normals = vertices.flatMap(() => [0, 1, 0]);
  data.indices = [0, 1, 2, 0, 2, 3];

  const mesh = new Mesh("floor", scene);
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}

// Gray walls hanging below a floor polygon so it reads as a solid slab.
function createSlabSides(scene: Scene, vertices: Vec2[]): Mesh {
  const thickness = 0.5;
  const data = new VertexData();
  data.positions = vertices.flatMap((p, i) => {
    const q = vertices[(i + 1) % vertices.length]!;
    return [p.x, 0, p.z, q.x, 0, q.z, q.x, -thickness, q.z, p.x, -thickness, p.z];
  });
  data.indices = vertices.flatMap((_, i) => [4 * i, 4 * i + 1, 4 * i + 2, 4 * i, 4 * i + 2, 4 * i + 3]);

  const mesh = new Mesh("floor-sides", scene);
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  const mat = new StandardMaterial("floor-sides-mat", scene);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(0.25, 0.25, 0.27);
  mat.specularColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.freeze();
  mesh.material = mat;
  return mesh;
}

// Show crosshatching until the floor image loads.
function createImageQuad(scene: Scene, vertices: Vec2[], imageUrl: string): Mesh {
  const placeholder = createQuad(scene, vertices);
  const placeholderMat = new StandardMaterial("floor-plan-placeholder-mat", scene);
  placeholderMat.diffuseColor = new Color3(1, 1, 1);
  placeholderMat.emissiveColor = new Color3(0.04, 0.04, 0.05);
  placeholderMat.specularColor = new Color3(0, 0, 0);
  placeholderMat.diffuseTexture = createCrosshatchTexture(scene);
  placeholderMat.backFaceCulling = false;
  placeholder.material = placeholderMat;
  placeholderMat.freeze();

  createSlabSides(scene, vertices).parent = placeholder;

  const top = createQuad(scene, vertices);
  top.parent = placeholder; // disposed with the parent via mesh.dispose(false, true)
  top.position.y = 0.005; // stay under the AOE telegraph plane at y = 0.01
  top.setEnabled(false);

  const mat = new StandardMaterial("floor-plan-mat", scene);
  // Keep the placeholder parent enabled so its image child stays visible.
  const reveal = () => {
    if (top.isDisposed()) return;
    top.setEnabled(true);
    mat.freeze();
  };
  const tex = new Texture(imageUrl, scene, undefined, undefined, undefined, reveal);
  tex.anisotropicFilteringLevel = 16;
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex; // self-lit so the art reads under the dim scene light
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  top.material = mat;
  return placeholder;
}

export function createZoneMesh(scene: Scene, zone: ZoneShape, floorPlan: FloorPlan): Mesh | null {
  if (zone.kind === "circle" && typeof floorPlan === "string" && floorPlan !== "squares") {
    return createFloorPlanCircle(scene, zone, FLOOR_PLAN_IMAGES[floorPlan]);
  }
  if (zone.kind === "polygon" && zone.image && zone.vertices.length === 4) {
    return createImageQuad(scene, zone.vertices, ZONE_IMAGES[zone.image]);
  }

  const mat = new StandardMaterial("floor-mat", scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.emissiveColor = new Color3(0.04, 0.04, 0.05);
  mat.specularColor = new Color3(0, 0, 0);
  const tex = typeof floorPlan === "object" ? null : createCrosshatchTexture(scene);
  mat.diffuseTexture = tex;
  if (typeof floorPlan === "object") {
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.emissiveColor = Color3.FromHexString(floorPlan.color);
    mat.disableLighting = true;
  }

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
      if (tex) {
        tex.uScale = span;
        tex.vScale = span;
      }
      break;
    }
    case "rect":
      mesh = CreateGround("floor", { width: zone.width, height: zone.height }, scene);
      mesh.position.set(zone.center.x, 0, zone.center.z);
      if (tex) {
        tex.uScale = zone.width / tileWorld;
        tex.vScale = zone.height / tileWorld;
      }
      break;
    case "polygon": {
      if (zone.vertices.length !== 4) {
        logger.warn("render", "only 4-sided polygon arena zones are rendered");
        return null;
      }
      mesh = createQuad(scene, zone.vertices);
      if (tex) {
        tex.uScale = 1;
        tex.vScale = 1;
      }
      break;
    }
  }
  mesh.material = mat;
  mat.freeze(); // static floor: never animates, so skip per-frame shader re-evaluation
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

  const drumMat = new StandardMaterial("floor-drum-mat", scene);
  drumMat.diffuseColor = new Color3(0, 0, 0);
  drumMat.emissiveColor = new Color3(0, 0, 0);
  drumMat.specularColor = new Color3(0, 0, 0);
  drumMat.alpha = 0.12; // see-through drum so the sides don't read as a solid black wall
  body.material = drumMat;
  drumMat.freeze(); // static

  // Placeholder crosshatch top, shown until the plan image finishes downloading/decoding so the
  // floor is never blank during that window (the images are large and load asynchronously).
  const placeholder = CreateDisc("floor-plan-placeholder", { radius: zone.radius, tessellation: 64 }, scene);
  placeholder.parent = body;
  placeholder.rotation.x = -Math.PI / 2;
  placeholder.position.set(0, thickness / 2 + 0.004, 0);
  const placeholderMat = new StandardMaterial("floor-plan-placeholder-mat", scene);
  placeholderMat.diffuseColor = new Color3(1, 1, 1);
  placeholderMat.emissiveColor = new Color3(0.04, 0.04, 0.05);
  placeholderMat.specularColor = new Color3(0, 0, 0);
  const placeholderTex = createCrosshatchTexture(scene);
  const span = (zone.radius * 2) / 4;
  placeholderTex.uScale = span;
  placeholderTex.vScale = span;
  placeholderMat.diffuseTexture = placeholderTex;
  placeholder.material = placeholderMat;
  placeholderMat.freeze(); // static crosshatch placeholder

  // Disc lies in the XY plane facing +Z; rotate it flat so it faces up, just above the top face.
  // Keep it below the AOE telegraph plane (world y = 0.01, see telegraphMeshes.ts) so AOEs draw
  // cleanly on top of the plan instead of z-fighting with it.
  const top = CreateDisc("floor-plan", { radius: zone.radius, tessellation: 64 }, scene);
  top.parent = body; // local-space child; disposed with the body via mesh.dispose(false, true)
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, thickness / 2 + 0.005, 0);
  top.setEnabled(false); // revealed once the texture is ready (see onLoad below)

  const imageMat = new StandardMaterial("floor-plan-mat", scene);
  // onLoad fires once the image is decoded and GPU-ready: swap the crosshatch out for the plan.
  // The isDisposed guard covers a rapid raid switch that disposes this floor mid-download.
  const reveal = () => {
    if (top.isDisposed()) return;
    top.setEnabled(true);
    placeholder.setEnabled(false);
    imageMat.freeze(); // texture is loaded + assigned; lock the now-static shader
  };
  const tex = new Texture(imageUrl, scene, undefined, undefined, undefined, reveal);
  tex.anisotropicFilteringLevel = 16; // sharpen the plan when viewed at the camera's grazing angle
  imageMat.diffuseTexture = tex;
  imageMat.emissiveTexture = tex; // self-lit so the plan reads clearly under the dim scene light
  imageMat.emissiveColor = new Color3(2, 2, 2); // brighten the plan above the dim base lighting
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
