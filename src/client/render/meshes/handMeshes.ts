import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Boss } from "@shared/types";
import { STATIC_ROOT } from "../../staticBase";
import { imageBillboardMaterial } from "./billboardMaterials";

export const HAND_IMAGE_URL = `${STATIC_ROOT}/model/raid/hand.png`;

const HAND_SIZE = 10;
const HAND_THICKNESS = 1;
const RIM_SCALE = 0.85;
const HAND_LATERAL_OFFSET = 11;
const RAISED_FORWARD_OFFSET = 6; // toward the party/arena centre, for the attacking hand
const GROUND_FORWARD_OFFSET = 2; // also toward the party, but closer to Kefka so it still touches the arena floor
const HAND_HEIGHT = 7;
const SKIN_TONE = Color3.FromHexString("#f2c9a8");

export type HandSide = "left" | "right";
export type HandPose = "ground" | "raised";

export type HandMeshes = { plane: Mesh; rim: Mesh };

export function createHandMeshes(scene: Scene, name: string): HandMeshes {
  const plane = CreatePlane(`${name}-plane`, { size: HAND_SIZE }, scene);
  plane.isPickable = false;
  plane.material = imageBillboardMaterial(scene, `${name}-mat`, HAND_IMAGE_URL);

  const rim = CreateBox(`${name}-rim`, {
    width: HAND_SIZE * RIM_SCALE,
    height: HAND_SIZE * RIM_SCALE,
    depth: HAND_THICKNESS,
  }, scene);
  rim.isPickable = false;
  const rimMat = new StandardMaterial(`${name}-rim-mat`, scene);
  rimMat.diffuseColor = SKIN_TONE;
  rimMat.specularColor = new Color3(0, 0, 0);
  rimMat.backFaceCulling = false; // matches the plane's convention; needed because side="left" mirrors via negative scaling.x
  rim.material = rimMat;

  return { plane, rim };
}

export function updateHandMeshes(handle: HandMeshes, boss: Boss, side: HandSide, pose: HandPose): void {
  const len = Math.hypot(boss.pos.x, boss.pos.z) || 1;
  const forward = { x: -boss.pos.x / len, z: -boss.pos.z / len };
  const right = { x: forward.z, z: -forward.x };
  const sign = side === "right" ? 1 : -1;
  const forwardOffset = pose === "ground" ? GROUND_FORWARD_OFFSET : RAISED_FORWARD_OFFSET;

  const anchorX = boss.pos.x + forward.x * forwardOffset + right.x * HAND_LATERAL_OFFSET * sign;
  const anchorZ = boss.pos.z + forward.z * forwardOffset + right.z * HAND_LATERAL_OFFSET * sign;

  const rotationX = pose === "ground" ? Math.PI / 2 : 0;
  // Fingers point toward the party/arena centre in both poses.
  const yaw = Math.atan2(forward.x, forward.z);
  const anchorY = pose === "ground" ? HAND_THICKNESS / 2 : HAND_HEIGHT;

  // The plane sits flush against the rim's outward face, offset along the same
  // facing normal used for the yaw, so it reads as a decal printed on the slab.
  const planeOffset = HAND_THICKNESS / 2 + 0.02;
  const normal = pose === "ground" ? { x: 0, z: 0 } : forward;
  const planeY = pose === "ground" ? anchorY + planeOffset : anchorY;

  for (const mesh of [handle.plane, handle.rim]) {
    mesh.rotation.x = rotationX;
    mesh.rotation.y = yaw;
    mesh.scaling.x = side === "left" ? -1 : 1;
  }

  handle.rim.position.set(anchorX, anchorY, anchorZ);
  handle.plane.position.set(
    anchorX + normal.x * planeOffset,
    planeY,
    anchorZ + normal.z * planeOffset,
  );
}

export function disposeHandMeshes(handle: HandMeshes | null): void {
  handle?.plane.dispose(false, true);
  handle?.rim.dispose(false, true);
}
