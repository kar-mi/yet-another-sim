import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveTower } from "@model/types";
import { clamp01 } from "@shared/math";
import { circlePath, createGroundCircle } from "@effects/babylon";

const DEFAULT_CYLINDER_COLOR = "#33ccff";
const RING_Y = 0.03;
const RING_RADIUS = 0.06;
const CIRCLE_Y = 0.04;
const INNER_RATIO = 0.82;
const CYL_TOP = 14;
const CYL_HEIGHT = 4;
const YELLOW = new Color3(0.95, 0.8, 0.2);
const RED = new Color3(0.9, 0.2, 0.2);
const WHITE = new Color3(1, 1, 1);
const SUCCESS = new Color3(0.2, 0.95, 0.35);
const FAILURE = new Color3(0.95, 0.2, 0.2);

export type TowerMeshes = {
  all: Mesh[];
  groundMats: StandardMaterial[];
  countColor: Color3;
  fallingObject?: { mesh: Mesh; mat: StandardMaterial; floorY: number };
  countCircles: { mesh: Mesh; mat: StandardMaterial }[];
};

function parseColor(hex: string | undefined): Color3 {
  return Color3.FromHexString(hex ?? DEFAULT_CYLINDER_COLOR);
}

export function createTowerMeshes(scene: Scene, tower: ActiveTower): TowerMeshes {
  const { x, z } = tower.pos;
  const inner = tower.radius * INNER_RATIO;
  const all: Mesh[] = [];

  const innerColor = tower.visual.groundStyle === "tank" ? RED : YELLOW;
  const outerColor = WHITE;

  const ring = CreateTube(`tower-ring-${tower.id}`, {
    path: circlePath(x, z, tower.radius, RING_Y),
    radius: RING_RADIUS,
    tessellation: 8,
    cap: BabylonMesh.CAP_ALL,
  }, scene);
  ring.isPickable = false;
  const ringMat = new StandardMaterial(`tower-ring-mat-${tower.id}`, scene);
  ringMat.diffuseColor = outerColor;
  ringMat.emissiveColor = outerColor.scale(0.7);
  ringMat.specularColor = new Color3(0, 0, 0);
  ring.material = ringMat;
  const groundMats: StandardMaterial[] = [ringMat];
  all.push(ring);

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

  const countCircles: { mesh: Mesh; mat: StandardMaterial }[] = [];
  if (tower.visual.countCircles && tower.requiredCount > 1) {
    const count = tower.requiredCount;
    const offsetR = inner * 0.7;
    const chordHalf = offsetR * Math.sin(Math.PI / count);
    const r = Math.min(0.5, chordHalf * 0.8, (inner - offsetR) * 0.9);
    for (let i = 0; i < count; i++) {
      const a = Math.PI / 4 + (i / count) * Math.PI * 2;
      const cx = x + Math.cos(a) * offsetR;
      const cz = z + Math.sin(a) * offsetR;
      const { mesh: c, material: mat } = createGroundCircle(scene, `tower-cnt-${tower.id}-${i}`, {
        radius: r,
        y: CIRCLE_Y,
        color: innerColor,
        alpha: 1,
        tessellation: 24,
      });
      c.position.set(cx, CIRCLE_Y, cz);
      countCircles.push({ mesh: c, mat });
      all.push(c);
    }
  }

  let fallingObject: { mesh: Mesh; mat: StandardMaterial; floorY: number } | undefined;
  const fallingKind = tower.visual.fallingObject ?? (tower.visual.fallingCylinder ? "cylinder" : undefined);
  if (fallingKind) {
    const cylColor = parseColor(tower.visual.cylinderColor);
    const size = tower.visual.cylinderThickness ?? Math.min(1.6, tower.radius * 0.6);
    let mesh: Mesh;
    let floorY: number;
    if (fallingKind === "sphere") {
      mesh = CreateSphere(`tower-sphere-${tower.id}`, { diameter: size, segments: 32 }, scene);
      floorY = size / 2;
    } else if (fallingKind === "box") {
      mesh = CreateBox(`tower-box-${tower.id}`, { width: size, depth: size, height: size }, scene);
      floorY = size / 2;
    } else {
      mesh = CreateCylinder(`tower-cyl-${tower.id}`, {
        diameter: size,
        height: CYL_HEIGHT,
        tessellation: 32,
      }, scene);
      floorY = CYL_HEIGHT / 2;
    }
    mesh.position.set(x, CYL_TOP, z);
    mesh.isPickable = false;
    const mat = new StandardMaterial(`tower-cyl-mat-${tower.id}`, scene);
    mat.diffuseColor = cylColor;
    mat.emissiveColor = cylColor.scale(0.4);
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = tower.visual.fallingObjectAlpha ?? 0.4;
    mesh.material = mat;
    fallingObject = { mesh, mat, floorY };
    all.push(mesh);
  }

  const handle: TowerMeshes = { all, groundMats, countColor: innerColor, fallingObject, countCircles };
  updateTowerMeshes(handle, tower, tower.telegraphStart);
  return handle;
}

export function updateTowerMeshes(handle: TowerMeshes, tower: ActiveTower, time: number): void {
  const span = tower.resolveAt - tower.telegraphStart;
  const progress = span > 0 ? clamp01((time - tower.telegraphStart) / span) : 1;

  if (handle.fallingObject) {
    const targetY = CYL_TOP + (handle.fallingObject.floorY - CYL_TOP) * progress;
    handle.fallingObject.mesh.position.y = Math.min(handle.fallingObject.mesh.position.y, targetY);
  }

  handle.countCircles.forEach(({ mat }, i) => {
    const filled = i < tower.soakerCount;
    mat.emissiveColor = filled ? handle.countColor.scale(0.9) : handle.countColor.scale(0.1);
    mat.alpha = filled ? 0.9 : 0.35;
  });

  if (tower.resolved && tower.outcome) {
    const c = tower.outcome === "success" ? SUCCESS : FAILURE;
    for (const mat of handle.groundMats) {
      mat.diffuseColor = c;
      mat.emissiveColor = c.scale(0.6);
    }
    if (handle.fallingObject) {
      handle.fallingObject.mat.diffuseColor = c;
      handle.fallingObject.mat.emissiveColor = c.scale(0.5);
    }
  }
}
