import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Mesh as BabylonMesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveInverse, Boss } from "../../shared/types";
import { createShapeMesh } from "./telegraphMeshes";

// Each inverse mechanic gets its own ring around the boss. The ring colour identifies the
// mechanic (e.g. blue = floor AOE, red = line AOE). The orbs riding the ring encode whether
// the mechanic is real (dark blue) or a fake "?" (reddish-orange with a yellow question mark).
const RING_RADIUS = 6;
const RING_THICKNESS = 0.5;
const ORBS_PER_RING = 2;
const ORB_SIZE = 1.8;
const DEFAULT_RING_COLOR = "#ffffff";

const REAL_ORB = "#1e3a8f";   // dark blue: honest telegraph
const FAKE_ORB = "#ff5a1f";   // reddish-orange: lying "?" telegraph
const QUESTION = "#ffdd33";   // yellow "?" on a fake orb

// Vertical slot for the n-th simultaneous ring: first on top, the next below it.
function ringY(index: number): number {
  return 3.2 - index * 2.8;
}

export type InverseMeshes = {
  all: Mesh[];
  telegraph: Mesh | null;
  telegraphMat: StandardMaterial | null;
  ring: Mesh;
  orbs: Mesh[];
};

function orbTexture(scene: Scene, id: string, inverted: boolean): DynamicTexture {
  const tex = new DynamicTexture(id, { width: 128, height: 128 }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fillStyle = inverted ? FAKE_ORB : REAL_ORB;
  ctx.fill();
  if (inverted) {
    ctx.fillStyle = QUESTION;
    ctx.font = "bold 90px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", 64, 72);
  }
  tex.update();
  return tex;
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

  // The mechanic's boss ring (solid, opaque), coloured to identify this mechanic.
  const ring = CreateTorus(`inv-ring-${inv.id}`, {
    diameter: RING_RADIUS * 2,
    thickness: RING_THICKNESS,
    tessellation: 48,
  }, scene);
  ring.isPickable = false;
  const ringColor = Color3.FromHexString(inv.ringColor ?? DEFAULT_RING_COLOR);
  const ringMat = new StandardMaterial(`inv-ring-mat-${inv.id}`, scene);
  ringMat.diffuseColor = ringColor;
  ringMat.emissiveColor = ringColor;
  ringMat.specularColor = new Color3(0, 0, 0);
  ringMat.disableLighting = true;
  ring.material = ringMat;
  all.push(ring);

  // Orbs riding the ring: a flat billboard circle whose colour + "?" reflect real vs fake.
  const orbs: Mesh[] = [];
  for (let i = 0; i < ORBS_PER_RING; i++) {
    const orb = CreatePlane(`inv-orb-${inv.id}-${i}`, { size: ORB_SIZE }, scene);
    orb.billboardMode = BabylonMesh.BILLBOARDMODE_ALL;
    orb.isPickable = false;
    orb.renderingGroupId = 1; // draw on top so it's always readable
    const tex = orbTexture(scene, `inv-orb-tex-${inv.id}-${i}`, inv.inverted);
    const mat = new StandardMaterial(`inv-orb-mat-${inv.id}-${i}`, scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveTexture = tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.disableDepthWrite = true;
    mat.backFaceCulling = false;
    orb.material = mat;
    orbs.push(orb);
    all.push(orb);
  }

  return { all, telegraph, telegraphMat, ring, orbs };
}

export function updateInverseMeshes(handle: InverseMeshes, inv: ActiveInverse, boss: Boss, time: number, index: number): void {
  // Telegraph color/alpha fade as the cast progresses (mirrors TelegraphLayer).
  if (handle.telegraphMat) {
    if (inv.resolved) {
      handle.telegraphMat.diffuseColor = new Color3(1, 1, 1);
      handle.telegraphMat.alpha = 0.8;
    } else {
      const span = inv.resolveAt - inv.telegraphStart;
      const progress = span > 0 ? Math.min(1, Math.max(0, (time - inv.telegraphStart) / span)) : 1;
      handle.telegraphMat.diffuseColor = inv.inverted
        ? new Color3(0.4, 0.6, 1)
        : new Color3(1, Math.max(0, 0.8 - progress * 0.6), 0);
      handle.telegraphMat.alpha = 0.25 + progress * 0.45;
    }
  }

  // Ring + orbs orbit the boss at this mechanic's vertical slot.
  const { x, z } = boss.pos;
  const y = ringY(index);
  handle.ring.position.set(x, y, z);
  const spin = time * 0.7;
  for (let i = 0; i < handle.orbs.length; i++) {
    const a = (i / handle.orbs.length) * Math.PI * 2 + spin;
    handle.orbs[i].position.set(x + Math.cos(a) * RING_RADIUS, y, z + Math.sin(a) * RING_RADIUS);
  }
}
