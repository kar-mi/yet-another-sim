import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { Waymark, WaymarkId } from "../../shared/types";

// FFXIV waymark convention: letter/number pairs share a color.
// A/1 red, B/2 yellow, C/3 blue, D/4 purple.
const WAYMARK_COLORS: Record<WaymarkId, Color3> = {
  A: new Color3(0.95, 0.25, 0.25), "1": new Color3(0.95, 0.25, 0.25),
  B: new Color3(0.95, 0.8, 0.2), "2": new Color3(0.95, 0.8, 0.2),
  C: new Color3(0.3, 0.55, 0.95), "3": new Color3(0.3, 0.55, 0.95),
  D: new Color3(0.7, 0.35, 0.9), "4": new Color3(0.7, 0.35, 0.9),
};

const FLOOR_Y = 0.06;
const SIZE = 1.6;
const GLYPH_SCALE = 1.15;
const GLYPH_RADIUS = 0.055;
const isLetter = (mark: WaymarkId) => mark >= "A" && mark <= "D";

type Stroke = [number, number][];

const line = (...points: Stroke): Stroke => points;

function arc(cx: number, cy: number, rx: number, ry: number, start: number, end: number, steps = 10): Stroke {
  const pts: Stroke = [];
  for (let i = 0; i <= steps; i++) {
    const t = start + (end - start) * (i / steps);
    pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return pts;
}

function join(...segments: Stroke[]): Stroke {
  const pts: Stroke = [];
  for (const segment of segments) {
    pts.push(...(pts.length ? segment.slice(1) : segment));
  }
  return pts;
}

const GLYPH_STROKES: Record<WaymarkId, Stroke[]> = {
  A: [join(line([-0.48, -0.58], [-0.06, 0.5]), arc(0, 0.5, 0.06, 0.08, Math.PI, 0, 5), line([0.06, 0.5], [0.48, -0.58])), line([-0.25, -0.04], [0.25, -0.04])],
  B: [
    line([-0.43, -0.6], [-0.43, 0.6]),
    join(line([-0.43, 0.58], [0.07, 0.58]), arc(0.07, 0.31, 0.34, 0.27, Math.PI / 2, -Math.PI / 2), line([0.07, 0.04], [-0.43, 0.04])),
    join(line([-0.43, 0.04], [0.12, 0.04]), arc(0.12, -0.28, 0.37, 0.32, Math.PI / 2, -Math.PI / 2), line([0.12, -0.6], [-0.43, -0.6])),
  ],
  C: [arc(0, 0, 0.54, 0.58, 0.7, Math.PI * 2 - 0.7, 18)],
  D: [line([-0.43, -0.6], [-0.43, 0.6]), join(line([-0.43, 0.6], [-0.12, 0.58]), arc(-0.12, 0, 0.58, 0.58, Math.PI / 2, -Math.PI / 2, 18), line([-0.12, -0.58], [-0.43, -0.6]))],
  "1": [line([0, -0.6], [0, 0.6]), line([-0.28, 0.35], [0, 0.6]), line([-0.32, -0.6], [0.32, -0.6])],
  "2": [arc(0, 0.32, 0.45, 0.28, 2.55, -0.2, 14), line([0.44, 0.24], [-0.42, -0.6], [0.5, -0.6])],
  "3": [
    join(line([-0.38, 0.56], [0.12, 0.56]), arc(0.12, 0.29, 0.36, 0.27, Math.PI / 2, -Math.PI / 2, 12), line([0.12, 0.02], [-0.08, 0.02])),
    join(line([-0.08, 0.02], [0.14, 0.02]), arc(0.14, -0.28, 0.38, 0.3, Math.PI / 2, -Math.PI / 2, 12), line([0.14, -0.58], [-0.4, -0.58])),
  ],
  "4": [line([0.34, -0.6], [0.34, 0.6]), line([-0.5, -0.02], [0.48, -0.02]), line([-0.22, 0.6], [-0.5, -0.02])],
};

export function createWaymarkMeshes(scene: Scene, waymark: Waymark): Mesh[] {
  const color = WAYMARK_COLORS[waymark.mark];
  const { x, z } = waymark.pos;

  // Empty outlined shape on the floor: ring for letters, square border for numbers.
  const path = isLetter(waymark.mark) ? circlePath(x, z) : squarePath(x, z);
  const floor = CreateTube(`wm-${waymark.mark}`, {
    path,
    radius: 0.09,
    tessellation: 8,
    cap: BabylonMesh.CAP_ALL,
  }, scene);
  const floorMat = new StandardMaterial(`wm-mat-${waymark.mark}`, scene);
  floorMat.diffuseColor = color;
  floorMat.emissiveColor = color.scale(0.6);
  floorMat.specularColor = new Color3(0, 0, 0);
  floorMat.alpha = 0.45;
  floor.material = floorMat;

  // Floating glyph that always faces the camera. It is built from stroke geometry,
  // not a textured plane, so there is no rectangular background to render.
  const label = new BabylonMesh(`wm-label-${waymark.mark}`, scene);
  label.position.set(x, 2.5, z);
  label.billboardMode = BabylonMesh.BILLBOARDMODE_ALL;
  label.isPickable = false;
  addGlyphStrokes(scene, label, waymark.mark, color);

  return [floor, label];
}

function circlePath(cx: number, cz: number): Vector3[] {
  const seg = 48;
  const pts: Vector3[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push(new Vector3(cx + Math.cos(a) * SIZE, FLOOR_Y, cz + Math.sin(a) * SIZE));
  }
  return pts;
}

function squarePath(cx: number, cz: number): Vector3[] {
  const h = SIZE;
  return [
    new Vector3(cx + h, FLOOR_Y, cz + h),
    new Vector3(cx + h, FLOOR_Y, cz - h),
    new Vector3(cx - h, FLOOR_Y, cz - h),
    new Vector3(cx - h, FLOOR_Y, cz + h),
    new Vector3(cx + h, FLOOR_Y, cz + h),
  ];
}

function addGlyphStrokes(scene: Scene, parent: Mesh, mark: WaymarkId, color: Color3): void {
  const mat = new StandardMaterial(`wm-label-mat-${mark}`, scene);
  mat.diffuseColor = color;
  mat.emissiveColor = color;
  mat.specularColor = Color3.Black();
  mat.alpha = 0.95;

  GLYPH_STROKES[mark].forEach((stroke, i) => {
    const mesh = CreateTube(`wm-label-${mark}-stroke-${i}`, {
      path: stroke.map(([sx, sy]) => new Vector3(sx * GLYPH_SCALE, sy * GLYPH_SCALE, 0)),
      radius: GLYPH_RADIUS,
      tessellation: 10,
      cap: BabylonMesh.CAP_ALL,
    }, scene);
    mesh.parent = parent;
    mesh.isPickable = false;
    mesh.material = mat;
  });
}
