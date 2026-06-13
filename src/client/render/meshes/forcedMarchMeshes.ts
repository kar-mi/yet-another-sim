import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveForcedMarch } from "@shared/types";
import { normalize } from "@shared/math";

// A forced-march trap is drawn as a translucent floor ring with a bright arrow pointing in the
// teleport direction. The first player to step inside is flung `distance` along the arrow; the
// trap then flashes and fades.
const Y = 0.02;
const ZONE_COLOR = new Color3(0.55, 0.3, 0.95);   // purple zone
const ARROW_COLOR = new Color3(0.6, 0.95, 1);      // bright cyan arrow
const TRIGGER_COLOR = new Color3(1, 0.85, 0.2);    // flash on trigger

export type ForcedMarchMeshes = {
  all: Mesh[];
  zoneMat: StandardMaterial;
  arrowMat: StandardMaterial;
};

export function createForcedMarchMeshes(scene: Scene, fm: ActiveForcedMarch): ForcedMarchMeshes {
  const dir = normalize(fm.direction);
  const yaw = Math.atan2(dir.x, dir.z);
  const perp = { x: dir.z, z: -dir.x };

  // Floor disc for the trigger zone.
  const zone = CreateDisc(`fm-zone-${fm.id}`, { radius: fm.radius, tessellation: 64 }, scene);
  zone.rotation.x = Math.PI / 2;
  zone.position.set(fm.pos.x, Y, fm.pos.z);
  zone.isPickable = false;
  const zoneMat = new StandardMaterial(`fm-zone-mat-${fm.id}`, scene);
  zoneMat.diffuseColor = ZONE_COLOR;
  zoneMat.emissiveColor = ZONE_COLOR.scale(0.4);
  zoneMat.specularColor = new Color3(0, 0, 0);
  zoneMat.backFaceCulling = false;
  zoneMat.alpha = 0.35;
  zone.material = zoneMat;

  // Arrow: a rectangular shaft plus a triangular head, both flat on the floor, pointing along dir.
  const total = fm.radius * 1.6;
  const headDepth = total * 0.4;
  const headWidth = fm.radius * 0.7;
  const shaftWidth = fm.radius * 0.22;
  const half = total / 2;
  const c = fm.pos;
  const tip = { x: c.x + dir.x * half, z: c.z + dir.z * half };
  const tail = { x: c.x - dir.x * half, z: c.z - dir.z * half };
  const baseCenter = { x: tip.x - dir.x * headDepth, z: tip.z - dir.z * headDepth };

  const shaftLen = total - headDepth;
  const shaftMid = { x: (tail.x + baseCenter.x) / 2, z: (tail.z + baseCenter.z) / 2 };
  const shaft = CreateGround(`fm-shaft-${fm.id}`, { width: shaftWidth, height: shaftLen }, scene);
  shaft.rotation.y = yaw;
  shaft.position.set(shaftMid.x, Y + 0.005, shaftMid.z);
  shaft.isPickable = false;

  const baseL = new Vector3(baseCenter.x + perp.x * headWidth, Y + 0.005, baseCenter.z + perp.z * headWidth);
  const baseR = new Vector3(baseCenter.x - perp.x * headWidth, Y + 0.005, baseCenter.z - perp.z * headWidth);
  const tipV = new Vector3(tip.x, Y + 0.005, tip.z);
  const head = CreateRibbon(`fm-head-${fm.id}`, { pathArray: [[tipV, tipV], [baseL, baseR]] }, scene);
  head.isPickable = false;

  const arrowMat = new StandardMaterial(`fm-arrow-mat-${fm.id}`, scene);
  arrowMat.diffuseColor = ARROW_COLOR;
  arrowMat.emissiveColor = ARROW_COLOR.scale(0.6);
  arrowMat.specularColor = new Color3(0, 0, 0);
  arrowMat.backFaceCulling = false;
  shaft.material = arrowMat;
  head.material = arrowMat;

  return { all: [zone, shaft, head], zoneMat, arrowMat };
}

export function updateForcedMarchMeshes(handle: ForcedMarchMeshes, fm: ActiveForcedMarch, time: number): void {
  if (fm.triggered && !fm.teleported) {
    // Charging: held player is winding up. Flash brightly and pulse fast.
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(time * 12));
    handle.zoneMat.diffuseColor = TRIGGER_COLOR;
    handle.zoneMat.emissiveColor = TRIGGER_COLOR.scale(0.8);
    handle.arrowMat.diffuseColor = TRIGGER_COLOR;
    handle.arrowMat.emissiveColor = TRIGGER_COLOR.scale(1);
    handle.zoneMat.alpha = 0.5 * pulse;
    handle.arrowMat.alpha = pulse;
  } else if (fm.triggered) {
    // Fired: fade away over the remaining post-delay + linger window.
    const since = time - ((fm.triggeredAt ?? time) + fm.preDelay);
    const fade = Math.max(0, 1 - since / (fm.postDelay + 0.4));
    handle.zoneMat.diffuseColor = TRIGGER_COLOR;
    handle.arrowMat.diffuseColor = TRIGGER_COLOR;
    handle.zoneMat.alpha = 0.35 * fade;
    handle.arrowMat.alpha = fade;
  } else {
    // Pulse the arrow gently while armed.
    const pulse = 0.7 + 0.3 * Math.abs(Math.sin(time * 3));
    handle.arrowMat.alpha = pulse;
  }
}
