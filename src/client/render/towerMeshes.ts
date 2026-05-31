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

const DEFAULT_CYLINDER_COLOR = "#33ccff";
const DISK_Y = 0.02;      // flatter than waymarks (0.06)
const RING_Y = 0.03;
const CIRCLE_Y = 0.04;
const INNER_RATIO = 0.82; // ring band inner edge as a fraction of the tower radius
const CYL_TOP = 14;       // height the falling cylinder starts at
const CYL_HEIGHT = 4;     // long and thin beam
const YELLOW = new Color3(0.95, 0.8, 0.2);
const RED = new Color3(0.9, 0.2, 0.2);
const SUCCESS = new Color3(0.2, 0.95, 0.35);
const FAILURE = new Color3(0.95, 0.2, 0.2);

// Handles to the meshes/materials a tower needs to update each frame.
export type TowerMeshes = {
  all: Mesh[];
  groundMats: StandardMaterial[]; // band + edge rings, recolored together on the flash
  countColor: Color3;
  cylinder?: { mesh: Mesh; mat: StandardMaterial };
  countCircles: { mesh: Mesh; mat: StandardMaterial }[];
};

function parseColor(hex: string | undefined): Color3 {
  return Color3.FromHexString(hex ?? DEFAULT_CYLINDER_COLOR);
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
  const { x, z } = tower.pos;
  const inner = tower.radius * INNER_RATIO;
  const all: Mesh[] = [];

  // Ground ring (donut outline). Standard towers are yellow inside with a red outer edge;
  // role ("tank") towers use two red lines.
  const innerColor = tower.visual.groundStyle === "tank" ? RED : YELLOW;
  const outerColor = RED;

  const band = CreateRibbon(`tower-${tower.id}`, {
    pathArray: [circlePath(x, z, tower.radius, DISK_Y), circlePath(x, z, inner, DISK_Y)],
  }, scene);
  band.isPickable = false;
  const bandMat = new StandardMaterial(`tower-mat-${tower.id}`, scene);
  bandMat.diffuseColor = innerColor;
  bandMat.emissiveColor = innerColor.scale(0.4);
  bandMat.specularColor = new Color3(0, 0, 0);
  bandMat.backFaceCulling = false;
  bandMat.alpha = 0.4;
  band.material = bandMat;
  all.push(band);

  const groundMats: StandardMaterial[] = [bandMat];
  for (const [edge, r, c] of [["outer", tower.radius, outerColor], ["inner", inner, innerColor]] as const) {
    const ring = CreateTube(`tower-ring-${edge}-${tower.id}`, {
      path: circlePath(x, z, r, RING_Y),
      radius: 0.12,
      tessellation: 8,
      cap: BabylonMesh.CAP_ALL,
    }, scene);
    ring.isPickable = false;
    const mat = new StandardMaterial(`tower-ring-${edge}-mat-${tower.id}`, scene);
    mat.diffuseColor = c;
    mat.emissiveColor = c.scale(0.7);
    mat.specularColor = new Color3(0, 0, 0);
    ring.material = mat;
    groundMats.push(mat);
    all.push(ring);
  }

  // Optional center pillar (the "rectangle" column).
  if (tower.visual.pillar) {
    const pillar = CreateBox(`tower-pillar-${tower.id}`, { width: 1.2, depth: 1.2, height: 4 }, scene);
    pillar.position.set(x, 2, z);
    pillar.isPickable = false;
    const mat = new StandardMaterial(`tower-pillar-mat-${tower.id}`, scene);
    mat.diffuseColor = innerColor;
    mat.emissiveColor = innerColor.scale(0.5);
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = 0.85;
    pillar.material = mat;
    all.push(pillar);
  }

  // Optional one-circle-per-required-soaker indicator, laid out in a centered row that
  // fits inside the ring's inner area.
  const countCircles: { mesh: Mesh; mat: StandardMaterial }[] = [];
  if (tower.visual.countCircles && tower.requiredCount > 0) {
    const count = tower.requiredCount;
    // Lay the soak markers out offset from the center (intercardinal-style ring), tucked
    // inside the tower's inner area. A single marker sits dead center.
    const offsetR = count === 1 ? 0 : inner * 0.7;
    const chordHalf = count > 1 ? offsetR * Math.sin(Math.PI / count) : inner * 0.5;
    const r = Math.min(0.5, chordHalf * 0.8, (inner - offsetR) * 0.9);
    for (let i = 0; i < count; i++) {
      const a = Math.PI / 4 + (i / count) * Math.PI * 2; // start at 45° (intercardinal)
      const cx = x + Math.cos(a) * offsetR;
      const cz = z + Math.sin(a) * offsetR;
      const c = CreateDisc(`tower-cnt-${tower.id}-${i}`, { radius: r, tessellation: 24 }, scene);
      c.rotation.x = Math.PI / 2;
      c.position.set(cx, CIRCLE_Y, cz);
      c.isPickable = false;
      const mat = new StandardMaterial(`tower-cnt-mat-${tower.id}-${i}`, scene);
      mat.diffuseColor = innerColor;
      mat.specularColor = new Color3(0, 0, 0);
      mat.backFaceCulling = false;
      c.material = mat;
      countCircles.push({ mesh: c, mat });
      all.push(c);
    }
  }

  // Optional falling cylinder (long, thin beam) with its own color; its height tracks the
  // cast progress (floor = resolve).
  let cylinder: { mesh: Mesh; mat: StandardMaterial } | undefined;
  if (tower.visual.fallingCylinder) {
    const cylColor = parseColor(tower.visual.cylinderColor);
    const mesh = CreateCylinder(`tower-cyl-${tower.id}`, {
      diameter: tower.visual.cylinderThickness ?? Math.min(1.6, tower.radius * 0.6),
      height: CYL_HEIGHT,
      tessellation: 32,
    }, scene);
    mesh.position.set(x, CYL_TOP, z);
    mesh.isPickable = false;
    const mat = new StandardMaterial(`tower-cyl-mat-${tower.id}`, scene);
    mat.diffuseColor = cylColor;
    mat.emissiveColor = cylColor.scale(0.4);
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = 0.4;
    mesh.material = mat;
    cylinder = { mesh, mat };
    all.push(mesh);
  }

  const handle: TowerMeshes = { all, groundMats, countColor: innerColor, cylinder, countCircles };
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
    mat.emissiveColor = filled ? handle.countColor.scale(0.9) : handle.countColor.scale(0.1);
    mat.alpha = filled ? 0.9 : 0.35;
  });

  // Post-resolve flash recolors the ground/cylinder by outcome.
  if (tower.resolved && tower.outcome) {
    const c = tower.outcome === "success" ? SUCCESS : FAILURE;
    for (const mat of handle.groundMats) {
      mat.diffuseColor = c;
      mat.emissiveColor = c.scale(0.6);
    }
    if (handle.cylinder) {
      handle.cylinder.mat.diffuseColor = c;
      handle.cylinder.mat.emissiveColor = c.scale(0.5);
    }
  }
}
