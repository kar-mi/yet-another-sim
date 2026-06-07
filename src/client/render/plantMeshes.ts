import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

// A Tele-Trouncing "plant" debuff draws an arrow flat on the floor under the player, pointing the
// way they'll be knocked when it expires. Geometry is built in local space pointing +Z and parented
// to a node so we only move/rotate the node as the player walks; alpha pulses faster as expiry nears.
const Y = 0.03;
const ARROW_COLOR = new Color3(1, 0.55, 0.15); // amber

export type PlantArrow = {
  all: (Mesh | TransformNode)[];
  root: TransformNode;
  mat: StandardMaterial;
};

export function createPlantArrow(scene: Scene, key: string, direction: [number, number]): PlantArrow {
  const root = new TransformNode(`plant-${key}`, scene);
  root.rotation.y = Math.atan2(direction[0], direction[1]); // align local +Z to the world heading

  const total = 3.2;
  const headDepth = total * 0.4;
  const headWidth = 0.8;
  const shaftWidth = 0.35;
  const shaftLen = total - headDepth;

  const shaft = CreateGround(`plant-shaft-${key}`, { width: shaftWidth, height: shaftLen }, scene);
  shaft.parent = root;
  shaft.position.set(0, Y, -headDepth / 2);
  shaft.isPickable = false;

  const tip = new Vector3(0, Y, total / 2);
  const baseL = new Vector3(headWidth, Y, total / 2 - headDepth);
  const baseR = new Vector3(-headWidth, Y, total / 2 - headDepth);
  const head = CreateRibbon(`plant-head-${key}`, { pathArray: [[tip, tip], [baseL, baseR]] }, scene);
  head.parent = root;
  head.isPickable = false;

  const mat = new StandardMaterial(`plant-mat-${key}`, scene);
  mat.diffuseColor = ARROW_COLOR;
  mat.emissiveColor = ARROW_COLOR.scale(0.6);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  shaft.material = mat;
  head.material = mat;

  return { all: [shaft, head, root], root, mat };
}

export function updatePlantArrow(arrow: PlantArrow, pos: { x: number; z: number }, remaining: number, time: number): void {
  arrow.root.position.set(pos.x, 0, pos.z);
  // Pulse gently far out, urgently in the last second before the drop.
  const speed = remaining < 1 ? 14 : 4;
  arrow.mat.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * speed));
}
