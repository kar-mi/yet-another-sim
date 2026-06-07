import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveInverse, AOEShape } from "../../shared/types";
import type { Vec2 } from "../../shared/math";
import { createShapeMesh } from "./telegraphMeshes";

const ORB_COUNT = 8;       // orbs per ring
const ORB_Y = 1.4;         // float height of the cosmetic orbs
const GLYPH_Y = 3.2;       // "?" billboard height above the telegraph
const FIRE = new Color3(1, 0.25, 0.15);
const ICE = new Color3(0.3, 0.6, 1);

export type InverseMeshes = {
  all: Mesh[];
  telegraph: Mesh | null;
  telegraphMat: StandardMaterial | null;
  fireOrbs: Mesh[];
  iceOrbs: Mesh[];
  center: Vec2;
  outerRadius: number;
  innerRadius: number;
};

// Center + a representative radius for an AOE shape, used to place the cosmetic orb rings.
function shapeCenter(shape: AOEShape): Vec2 {
  switch (shape.kind) {
    case "circle": return shape.center;
    case "donut": return shape.center;
    case "cone": return shape.origin;
    case "rect": return shape.origin;
  }
}

function shapeExtent(shape: AOEShape): number {
  switch (shape.kind) {
    case "circle": return shape.radius;
    case "donut": return shape.outer;
    case "cone": return shape.length;
    case "rect": return shape.length;
  }
}

function createOrb(scene: Scene, id: string, diameter: number, color: Color3): Mesh {
  const orb = CreateSphere(id, { diameter, segments: 8 }, scene);
  orb.isPickable = false;
  const mat = new StandardMaterial(`${id}-mat`, scene);
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(0.7);
  mat.specularColor = new Color3(0, 0, 0);
  orb.material = mat;
  return orb;
}

export function createInverseMeshes(scene: Scene, inv: ActiveInverse): InverseMeshes {
  const all: Mesh[] = [];
  const center = shapeCenter(inv.shownShape);
  const extent = shapeExtent(inv.shownShape);
  const outerRadius = extent + 2;
  const innerRadius = Math.max(1.5, extent * 0.6);

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

  // Two cosmetic rings of orbs (fire outer, ice inner) that counter-rotate over the telegraph.
  const fireOrbs: Mesh[] = [];
  const iceOrbs: Mesh[] = [];
  for (let i = 0; i < ORB_COUNT; i++) {
    const fire = createOrb(scene, `inv-fire-${inv.id}-${i}`, 0.7, FIRE);
    const ice = createOrb(scene, `inv-ice-${inv.id}-${i}`, 0.55, ICE);
    fireOrbs.push(fire);
    iceOrbs.push(ice);
    all.push(fire, ice);
  }

  return { all, telegraph, telegraphMat, fireOrbs, iceOrbs, center, outerRadius, innerRadius };
}

export function updateInverseMeshes(handle: InverseMeshes, inv: ActiveInverse, time: number): void {
  // Telegraph color/alpha fade as the cast progresses (mirrors TelegraphLayer).
  if (handle.telegraphMat) {
    if (inv.resolved) {
      handle.telegraphMat.diffuseColor = new Color3(1, 1, 1);
      handle.telegraphMat.alpha = 0.8;
    } else {
      const span = inv.resolveAt - inv.telegraphStart;
      const progress = span > 0 ? Math.min(1, Math.max(0, (time - inv.telegraphStart) / span)) : 1;
      // Inverted telegraphs glow cooler (it's a lie); normal ones use the warm telegraph hue.
      handle.telegraphMat.diffuseColor = inv.inverted
        ? new Color3(0.4, 0.6, 1)
        : new Color3(1, Math.max(0, 0.8 - progress * 0.6), 0);
      handle.telegraphMat.alpha = 0.25 + progress * 0.45;
    }
  }

  // Counter-rotating orb rings.
  const { center } = handle;
  const fireSpin = time * 0.6;
  const iceSpin = -time * 0.85;
  for (let i = 0; i < handle.fireOrbs.length; i++) {
    const base = (i / handle.fireOrbs.length) * Math.PI * 2;
    const fa = base + fireSpin;
    handle.fireOrbs[i].position.set(
      center.x + Math.cos(fa) * handle.outerRadius, ORB_Y,
      center.z + Math.sin(fa) * handle.outerRadius,
    );
    const ia = base + iceSpin;
    handle.iceOrbs[i].position.set(
      center.x + Math.cos(ia) * handle.innerRadius, ORB_Y,
      center.z + Math.sin(ia) * handle.innerRadius,
    );
  }
}
