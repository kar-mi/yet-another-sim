import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveInverse, AOEShape, Boss } from "../../shared/types";
import { createShapeMesh } from "./telegraphMeshes";

const GLYPH_Y = 3.2;       // "?" billboard height above the telegraph
const FIRE = new Color3(1, 0.25, 0.15);
const ICE = new Color3(0.3, 0.6, 1);

// Cosmetic fire/ice rings drawn around the boss while any "?" mechanic is active.
const RING_Y = 1.2;              // float height of the rings/orbs around the boss
const FIRE_RING_RADIUS = 6.5;
const ICE_RING_RADIUS = 4.5;
const RING_THICKNESS = 0.5;
const ORBS_PER_RING = 2;

export type InverseMeshes = {
  all: Mesh[];
  telegraph: Mesh | null;
  telegraphMat: StandardMaterial | null;
};

export type OrbRings = {
  all: Mesh[];
  fireRing: Mesh;
  iceRing: Mesh;
  fireOrbs: Mesh[];
  iceOrbs: Mesh[];
};

// Center of an AOE shape, used to place the "?" glyph over the shown telegraph.
function shapeCenter(shape: AOEShape): { x: number; z: number } {
  switch (shape.kind) {
    case "circle": return shape.center;
    case "donut": return shape.center;
    case "cone": return shape.origin;
    case "rect": return shape.origin;
  }
}

export function createInverseMeshes(scene: Scene, inv: ActiveInverse): InverseMeshes {
  const all: Mesh[] = [];

  // Shown telegraph footprint (always drawn). The hidden shape is intentionally not rendered.
  const telegraph = createShapeMesh(scene, `inv-${inv.id}`, inv.shownShape);
  let telegraphMat: StandardMaterial | null = null;
  if (telegraph) {
    telegraphMat = new StandardMaterial(`inv-tel-mat-${inv.id}`, scene);
    telegraphMat.specularColor = new Color3(0, 0, 0);
    telegraphMat.backFaceCulling = false;
    telegraph.material = telegraphMat;
    telegraph.isPickable = false;
    all.push(telegraph);
  }

  // "?" billboard glyph: only when this telegraph is a lie (inverted).
  if (inv.inverted) {
    const center = shapeCenter(inv.shownShape);
    const glyph = CreatePlane(`inv-glyph-${inv.id}`, { size: 2.2 }, scene);
    glyph.billboardMode = BabylonMesh.BILLBOARDMODE_ALL;
    glyph.isPickable = false;
    glyph.position.set(center.x, GLYPH_Y, center.z);
    const tex = new DynamicTexture(`inv-glyph-tex-${inv.id}`, { width: 128, height: 128 }, scene, false);
    tex.hasAlpha = true;
    tex.drawText("?", null, 104, "bold 112px sans-serif", "#ffdd33", "transparent", true, true);
    const mat = new StandardMaterial(`inv-glyph-mat-${inv.id}`, scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveTexture = tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    glyph.material = mat;
    all.push(glyph);
  }

  return { all, telegraph, telegraphMat };
}

export function updateInverseMeshes(handle: InverseMeshes, inv: ActiveInverse, time: number): void {
  // Telegraph color/alpha fade as the cast progresses (mirrors TelegraphLayer).
  if (!handle.telegraphMat) return;
  if (inv.resolved) {
    handle.telegraphMat.diffuseColor = new Color3(1, 1, 1);
    handle.telegraphMat.alpha = 0.8;
    return;
  }
  const span = inv.resolveAt - inv.telegraphStart;
  const progress = span > 0 ? Math.min(1, Math.max(0, (time - inv.telegraphStart) / span)) : 1;
  // Inverted telegraphs glow cooler (it's a lie); normal ones use the warm telegraph hue.
  handle.telegraphMat.diffuseColor = inv.inverted
    ? new Color3(0.4, 0.6, 1)
    : new Color3(1, Math.max(0, 0.8 - progress * 0.6), 0);
  handle.telegraphMat.alpha = 0.25 + progress * 0.45;
}

function createRing(scene: Scene, id: string, radius: number, color: Color3): Mesh {
  const ring = CreateTorus(id, {
    diameter: radius * 2,
    thickness: RING_THICKNESS,
    tessellation: 48,
  }, scene);
  ring.isPickable = false;
  const mat = new StandardMaterial(`${id}-mat`, scene);
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(0.6);
  mat.specularColor = new Color3(0, 0, 0);
  ring.material = mat;
  return ring;
}

function createRingOrbs(scene: Scene, id: string, diameter: number, color: Color3): Mesh[] {
  const orbs: Mesh[] = [];
  for (let i = 0; i < ORBS_PER_RING; i++) {
    const orb = CreateSphere(`${id}-${i}`, { diameter, segments: 12 }, scene);
    orb.isPickable = false;
    const mat = new StandardMaterial(`${id}-${i}-mat`, scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.8);
    mat.specularColor = new Color3(0, 0, 0);
    orb.material = mat;
    orbs.push(orb);
  }
  return orbs;
}

export function createOrbRings(scene: Scene): OrbRings {
  const fireRing = createRing(scene, "inv-fire-ring", FIRE_RING_RADIUS, FIRE);
  const iceRing = createRing(scene, "inv-ice-ring", ICE_RING_RADIUS, ICE);
  const fireOrbs = createRingOrbs(scene, "inv-fire-orb", 1.8, FIRE);
  const iceOrbs = createRingOrbs(scene, "inv-ice-orb", 1.5, ICE);
  return { all: [fireRing, iceRing, ...fireOrbs, ...iceOrbs], fireRing, iceRing, fireOrbs, iceOrbs };
}

export function updateOrbRings(rings: OrbRings, boss: Boss, time: number): void {
  const { x, z } = boss.pos;
  rings.fireRing.position.set(x, RING_Y, z);
  rings.iceRing.position.set(x, RING_Y, z);

  const fireSpin = time * 0.6;
  const iceSpin = -time * 0.85;
  for (let i = 0; i < rings.fireOrbs.length; i++) {
    const base = (i / rings.fireOrbs.length) * Math.PI * 2;
    const fa = base + fireSpin;
    rings.fireOrbs[i].position.set(
      x + Math.cos(fa) * FIRE_RING_RADIUS, RING_Y,
      z + Math.sin(fa) * FIRE_RING_RADIUS,
    );
    const ia = base + iceSpin;
    rings.iceOrbs[i].position.set(
      x + Math.cos(ia) * ICE_RING_RADIUS, RING_Y,
      z + Math.sin(ia) * ICE_RING_RADIUS,
    );
  }
}

export function setOrbRingsEnabled(rings: OrbRings, enabled: boolean): void {
  for (const mesh of rings.all) mesh.setEnabled(enabled);
}
