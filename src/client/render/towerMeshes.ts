import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateRibbon } from "@babylonjs/core/Meshes/Builders/ribbonBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveTower } from "../../shared/types";
import { clamp01 } from "../../shared/math";

const DEFAULT_COLOR = "#33ccff";
const DISK_Y = 0.02;      // flatter than waymarks (0.06)
const RING_Y = 0.03;
const CIRCLE_Y = 0.04;
const INNER_RATIO = 0.82; // ring band inner edge as a fraction of the tower radius
const CYL_TOP = 12;       // height the falling cylinder starts at
const CYL_HEIGHT = 1;
const SUCCESS = new Color3(0.2, 0.95, 0.35);
const FAILURE = new Color3(0.95, 0.2, 0.2);

// Handles to the meshes/materials a tower needs to update each frame.
export type TowerMeshes = {
  all: Mesh[];
  baseColor: Color3;
  diskMat: StandardMaterial;
  ringMat: StandardMaterial;
  cylinder?: { mesh: Mesh; mat: StandardMaterial };
  countCircles: { mesh: Mesh; mat: StandardMaterial }[];
};

function parseColor(hex: string | undefined): Color3 {
  return Color3.FromHexString(hex ?? DEFAULT_COLOR);
}

function circlePath(cx: number, cz: number, radius: number, y: number): Vector3[] {
  const seg = 48;
  const pts: Vector3[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push(new Vector3(cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius));
  }
  return pts;
}

export function createTowerMeshes(scene: Scene, tower: ActiveTower): TowerMeshes {
  const color = parseColor(tower.visual.color);
  const { x, z } = tower.pos;
  const all: Mesh[] = [];

  // Flat translucent ring band (donut) on the floor — an outline, not a filled disk.
  const inner = tower.radius * INNER_RATIO;
  const band = CreateRibbon(`tower-${tower.id}`, {
    pathArray: [circlePath(x, z, tower.radius, DISK_Y), circlePath(x, z, inner, DISK_Y)],
  }, scene);
  band.isPickable = false;
  const diskMat = new StandardMaterial(`tower-mat-${tower.id}`, scene);
  diskMat.diffuseColor = color;
  diskMat.emissiveColor = color.scale(0.4);
  diskMat.specularColor = new Color3(0, 0, 0);
  diskMat.backFaceCulling = false;
  diskMat.alpha = 0.4;
  band.material = diskMat;
  all.push(band);

  // Bright ring outlines on the inner and outer edges of the band.
  const ringMat = new StandardMaterial(`tower-ring-mat-${tower.id}`, scene);
  ringMat.diffuseColor = color;
  ringMat.emissiveColor = color.scale(0.7);
  ringMat.specularColor = new Color3(0, 0, 0);
  for (const [edge, r] of [["outer", tower.radius], ["inner", inner]] as const) {
    const ring = CreateTube(`tower-ring-${edge}-${tower.id}`, {
      path: circlePath(x, z, r, RING_Y),
      radius: 0.12,
      tessellation: 8,
      cap: BabylonMesh.CAP_ALL,
    }, scene);
    ring.isPickable = false;
    ring.material = ringMat;
    all.push(ring);
  }

  // Optional center pillar.
  if (tower.visual.pillar) {
    const pillar = CreateBox(`tower-pillar-${tower.id}`, { width: 0.6, depth: 0.6, height: 4 }, scene);
    pillar.position.set(x, 2, z);
    pillar.isPickable = false;
    const mat = new StandardMaterial(`tower-pillar-mat-${tower.id}`, scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.5);
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = 0.85;
    pillar.material = mat;
    all.push(pillar);
  }

  // Optional one-circle-per-required-soaker indicator, laid out in a centered row.
  const countCircles: { mesh: Mesh; mat: StandardMaterial }[] = [];
  if (tower.visual.countCircles && tower.requiredCount > 0) {
    const r = Math.min(0.6, tower.radius / (tower.requiredCount + 1));
    const gap = r * 2.4;
    const startX = x - (gap * (tower.requiredCount - 1)) / 2;
    for (let i = 0; i < tower.requiredCount; i++) {
      const c = CreateDisc(`tower-cnt-${tower.id}-${i}`, { radius: r, tessellation: 24 }, scene);
      c.rotation.x = Math.PI / 2;
      c.position.set(startX + i * gap, CIRCLE_Y, z);
      c.isPickable = false;
      const mat = new StandardMaterial(`tower-cnt-mat-${tower.id}-${i}`, scene);
      mat.diffuseColor = color;
      mat.specularColor = new Color3(0, 0, 0);
      mat.backFaceCulling = false;
      c.material = mat;
      countCircles.push({ mesh: c, mat });
      all.push(c);
    }
  }

  // Optional falling cylinder; its height tracks the cast progress (floor = resolve).
  let cylinder: { mesh: Mesh; mat: StandardMaterial } | undefined;
  if (tower.visual.fallingCylinder) {
    const mesh = CreateCylinder(`tower-cyl-${tower.id}`, {
      diameter: tower.radius * 2 * 0.85,
      height: CYL_HEIGHT,
      tessellation: 48,
    }, scene);
    mesh.position.set(x, CYL_TOP, z);
    mesh.isPickable = false;
    const mat = new StandardMaterial(`tower-cyl-mat-${tower.id}`, scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.4);
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = 0.35;
    mesh.material = mat;
    cylinder = { mesh, mat };
    all.push(mesh);
  }

  const handle: TowerMeshes = { all, baseColor: color, diskMat, ringMat, cylinder, countCircles };
  updateTowerMeshes(handle, tower, tower.telegraphStart);
  return handle;
}

export function updateTowerMeshes(handle: TowerMeshes, tower: ActiveTower, time: number): void {
  const span = tower.resolveAt - tower.telegraphStart;
  const progress = span > 0 ? clamp01((time - tower.telegraphStart) / span) : 1;

  // Falling cylinder descends so its base meets the floor exactly at resolve.
  if (handle.cylinder) {
    const floorY = CYL_HEIGHT / 2;
    handle.cylinder.mesh.position.y = CYL_TOP + (floorY - CYL_TOP) * progress;
  }

  // Count circles: brighten the ones that currently have a valid soaker.
  handle.countCircles.forEach(({ mat }, i) => {
    const filled = i < tower.soakerCount;
    mat.emissiveColor = filled ? handle.baseColor.scale(0.9) : handle.baseColor.scale(0.1);
    mat.alpha = filled ? 0.85 : 0.35;
  });

  // Post-resolve flash recolors the disk/ring/cylinder by outcome.
  if (tower.resolved && tower.outcome) {
    const c = tower.outcome === "success" ? SUCCESS : FAILURE;
    handle.diskMat.diffuseColor = c;
    handle.diskMat.emissiveColor = c.scale(0.5);
    handle.diskMat.alpha = 0.5;
    handle.ringMat.diffuseColor = c;
    handle.ringMat.emissiveColor = c.scale(0.8);
    if (handle.cylinder) {
      handle.cylinder.mat.diffuseColor = c;
      handle.cylinder.mat.emissiveColor = c.scale(0.5);
    }
  }
}
