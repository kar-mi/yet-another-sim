import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { Boss } from "@shared/types";
import { STATIC_ROOT } from "../../staticBase";
import { imageBillboardMaterial } from "./billboardMaterials";

export const HAND_IMAGE_URL = `${STATIC_ROOT}/model/raid/hand.png`;

const HAND_SIZE = 10;
const HAND_LATERAL_OFFSET = 11;
const HAND_HEIGHT = 7;

export type HandSide = "left" | "right";

export function createHandMesh(scene: Scene): Mesh {
  const mesh = CreatePlane("slap-happy-hand", { size: HAND_SIZE }, scene);
  mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  mesh.isPickable = false;
  mesh.material = imageBillboardMaterial(scene, "slap-happy-hand-mat", HAND_IMAGE_URL);
  return mesh;
}

export function updateHandMesh(mesh: Mesh, boss: Boss, side: HandSide): void {
  const len = Math.hypot(boss.pos.x, boss.pos.z) || 1;
  const forward = { x: -boss.pos.x / len, z: -boss.pos.z / len };
  const right = { x: forward.z, z: -forward.x };
  const sign = side === "right" ? 1 : -1;

  mesh.position.set(
    boss.pos.x + right.x * HAND_LATERAL_OFFSET * sign,
    HAND_HEIGHT,
    boss.pos.z + right.z * HAND_LATERAL_OFFSET * sign,
  );
  mesh.scaling.x = side === "left" ? -1 : 1;
}
