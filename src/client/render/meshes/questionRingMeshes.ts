import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import { applyAlphaTest } from "./billboardMaterials";

const RING_RADIUS = 6;
const RING_THICKNESS = 0.5;
const ORBS_PER_RING = 2;
const ORB_SIZE = 2.6;
export const QUESTION_RING_DEFAULT_Y = 2;

const REAL_ORB = "#1e3a8f";
const FAKE_ORB = "#ff5a1f";
const QUESTION = "#ffdd33";

export type QuestionRingMeshes = {
  all: Mesh[];
  ring: Mesh;
  orbs: Mesh[];
  materials: StandardMaterial[];
};

function orbTexture(scene: Scene, id: string, inverted: boolean): DynamicTexture {
  const tex = new DynamicTexture(id, { width: 128, height: 128 }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fillStyle = inverted ? FAKE_ORB : REAL_ORB;
  ctx.fill();
  if (inverted) {
    tex.drawText("?", null, 92, "bold 90px sans-serif", QUESTION, "", true, true);
  } else {
    tex.update();
  }
  return tex;
}

export function createQuestionRing(
  scene: Scene,
  prefix: string,
  id: string,
  ringColorHex: string,
  inverted: boolean,
): QuestionRingMeshes {
  const all: Mesh[] = [];
  const materials: StandardMaterial[] = [];

  const ring = CreateTorus(`${prefix}-ring-${id}`, {
    diameter: RING_RADIUS * 2,
    thickness: RING_THICKNESS,
    tessellation: 48,
  }, scene);
  ring.isPickable = false;
  const ringColor = Color3.FromHexString(ringColorHex);
  const ringMat = new StandardMaterial(`${prefix}-ring-mat-${id}`, scene);
  ringMat.diffuseColor = ringColor;
  ringMat.emissiveColor = ringColor;
  ringMat.specularColor = new Color3(0, 0, 0);
  ringMat.disableLighting = true;
  ring.material = ringMat;
  all.push(ring);
  materials.push(ringMat);

  const orbs: Mesh[] = [];
  for (let i = 0; i < ORBS_PER_RING; i++) {
    const orb = CreatePlane(`${prefix}-orb-${id}-${i}`, { size: ORB_SIZE }, scene);
    orb.billboardMode = BabylonMesh.BILLBOARDMODE_ALL;
    orb.isPickable = false;
    const tex = orbTexture(scene, `${prefix}-orb-tex-${id}-${i}`, inverted);
    const mat = new StandardMaterial(`${prefix}-orb-mat-${id}-${i}`, scene);
    applyAlphaTest(mat, tex);
    orb.material = mat;
    orbs.push(orb);
    all.push(orb);
    materials.push(mat);
  }

  return { all, ring, orbs, materials };
}

export function updateQuestionRing(handle: Pick<QuestionRingMeshes, "ring" | "orbs">, x: number, z: number, y: number, time: number): void {
  handle.ring.position.set(x, y, z);
  const spin = time * 0.7;
  for (let i = 0; i < handle.orbs.length; i++) {
    const a = (i / handle.orbs.length) * Math.PI * 2 + spin;
    handle.orbs[i].position.set(x + Math.cos(a) * RING_RADIUS, y, z + Math.sin(a) * RING_RADIUS);
  }
}
