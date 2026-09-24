import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveGaze } from "@model/types";

const DEFAULT_VISUAL = { width: 4, height: 3, depth: 0.4 };

const NORMAL_BG = "#141a33";
const REVERSE_BG = "#3a1d14";
const NORMAL_ACCENT = "#5a8cff";
const REVERSE_ACCENT = "#ff5a1f";
const QUESTION = "#ffdd33";

export type GazeMeshes = {
  all: Mesh[];
  mat: StandardMaterial;
};

function eyeTexture(scene: Scene, id: string, reverse: boolean): DynamicTexture {
  const W = 256, H = 192;
  const tex = new DynamicTexture(id, { width: W, height: H }, scene, false);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = reverse ? REVERSE_BG : NORMAL_BG;
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 8;
  ctx.strokeStyle = reverse ? REVERSE_ACCENT : NORMAL_ACCENT;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  const cx = W / 2, cy = H / 2 + 12;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.575);
  ctx.beginPath();
  ctx.arc(0, 0, 80, 0, Math.PI * 2);
  ctx.fillStyle = "#f2f2f2";
  ctx.fill();
  ctx.restore();

  if (reverse) {
    tex.drawText("?", null, cy + 38, "bold 110px sans-serif", QUESTION, "", true, true);
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fillStyle = "#3a7bd5";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fillStyle = "#000000";
    ctx.fill();
    tex.update();
  }
  return tex;
}

export function createGazeMeshes(scene: Scene, gz: ActiveGaze): GazeMeshes {
  const v = gz.visual ?? DEFAULT_VISUAL;
  const board = CreateBox(`gaze-${gz.id}`, { width: v.width, height: v.height, depth: v.depth }, scene);
  board.position.set(gz.pos.x, v.height / 2 + 1, gz.pos.z);
  board.rotation.y = Math.atan2(gz.pos.x, gz.pos.z);
  board.isPickable = false;

  const tex = eyeTexture(scene, `gaze-tex-${gz.id}`, gz.reverse);
  const mat = new StandardMaterial(`gaze-mat-${gz.id}`, scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  board.material = mat;

  return { all: [board], mat };
}

export function updateGazeMeshes(handle: GazeMeshes, gz: ActiveGaze, time: number): void {
  handle.mat.alpha = gz.resolved ? Math.max(0, 1 - (time - gz.resolveAt) / 0.5) : 1;
}
