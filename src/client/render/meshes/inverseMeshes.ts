import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { ActiveInverse, Boss } from "../../../shared/types";
import {
  createQuestionRing,
  QUESTION_RING_DEFAULT_Y,
  updateQuestionRing,
  type QuestionRingMeshes,
} from "./questionRingMeshes";
import { createShapeMesh } from "./telegraphMeshes";

// Each inverse mechanic gets ONE ring around the boss. The ring colour identifies the mechanic
// (e.g. blue = floor AOE, red = line AOE) and its height is authored per mechanic. The orbs
// riding the ring encode whether the mechanic is real (dark blue) or a fake "?" (reddish-orange
// with a yellow question mark).
const DEFAULT_RING_COLOR = "#ffffff";
const DEFAULT_TELEGRAPH_ALPHA = 0.25;

export type InverseMeshes = {
  all: Mesh[];
  telegraphMats: StandardMaterial[];
  questionRing: QuestionRingMeshes;
};

export function createInverseMeshes(scene: Scene, inv: ActiveInverse): InverseMeshes {
  const all: Mesh[] = [];

  // Shown telegraph footprints (always drawn). The hidden shapes are intentionally not rendered.
  const telegraphMats: StandardMaterial[] = [];
  inv.shownShapes.forEach((shape, i) => {
    const mesh = createShapeMesh(scene, `inv-${inv.id}-${i}`, shape);
    if (!mesh) return;
    const mat = new StandardMaterial(`inv-tel-mat-${inv.id}-${i}`, scene);
    mat.specularColor = new Color3(0, 0, 0);
    mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.isPickable = false;
    telegraphMats.push(mat);
    all.push(mesh);
  });

  const questionRing = createQuestionRing(scene, "inv", inv.id, inv.ringColor ?? DEFAULT_RING_COLOR, inv.inverted);
  all.push(...questionRing.all);

  return { all, telegraphMats, questionRing };
}

export function updateInverseMeshes(handle: InverseMeshes, inv: ActiveInverse, boss: Boss, time: number): void {
  // Telegraph colour still warms by cast progress when no authored ring colour is present.
  const span = inv.resolveAt - inv.telegraphStart;
  const progress = span > 0 ? Math.min(1, Math.max(0, (time - inv.telegraphStart) / span)) : 1;
  for (const mat of handle.telegraphMats) {
    if (inv.resolved) {
      mat.diffuseColor.set(1, 1, 1);
      mat.alpha = 0.8;
    } else {
      if (inv.ringColor) {
        mat.diffuseColor.fromHexString(inv.ringColor);
      } else if (inv.inverted) {
        mat.diffuseColor.set(0.4, 0.6, 1);
      } else {
        mat.diffuseColor.set(1, Math.max(0, 0.8 - progress * 0.6), 0);
      }
      mat.alpha = inv.telegraphAlpha ?? DEFAULT_TELEGRAPH_ALPHA;
    }
  }

  // Ring + orbs orbit the boss at this mechanic's authored height.
  const { x, z } = boss.pos;
  const y = inv.ringHeight ?? QUESTION_RING_DEFAULT_Y;
  updateQuestionRing(handle.questionRing, x, z, y, time);
}
