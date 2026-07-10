import type { Scene } from "@babylonjs/core/scene";
import type { ActiveInverse, Boss } from "@shared/types";
import {
  createQuestionRing,
  QUESTION_RING_DEFAULT_Y,
  updateQuestionRing,
  type QuestionRingMeshes,
} from "./questionRingMeshes";

// Each inverse mechanic gets ONE ring around the boss. The ring colour identifies the mechanic
// (e.g. blue = floor AOE, red = line AOE) and its height is authored per mechanic. The orbs
// riding the ring encode whether the mechanic is real (dark blue) or a fake "?" (reddish-orange
// with a yellow question mark). The shown-shape telegraph footprints are handled separately via
// FloorAoe/syncFloorAoeMeshes (see InverseLayer).
const DEFAULT_RING_COLOR = "#ffffff";

export function createQuestionRingForInverse(scene: Scene, inv: ActiveInverse): QuestionRingMeshes {
  return createQuestionRing(scene, "inv", inv.id, inv.ringColor ?? DEFAULT_RING_COLOR, inv.inverted);
}

export function updateQuestionRingForInverse(handle: QuestionRingMeshes, inv: ActiveInverse, boss: Boss, time: number): void {
  const { x, z } = boss.pos;
  const y = inv.ringHeight ?? QUESTION_RING_DEFAULT_Y;
  updateQuestionRing(handle, x, z, y, time);
}
