import type { Scene } from "@babylonjs/core/scene";
import type { ActiveInverse, Boss } from "@model/types";
import {
  createQuestionRing,
  QUESTION_RING_DEFAULT_Y,
  updateQuestionRing,
  type QuestionRingMeshes,
} from "@effects/babylon";

const DEFAULT_RING_COLOR = "#ffffff";

export function createQuestionRingForInverse(scene: Scene, inv: ActiveInverse): QuestionRingMeshes {
  return createQuestionRing(scene, "inv", inv.id, inv.ringColor ?? DEFAULT_RING_COLOR, inv.inverted);
}

export function updateQuestionRingForInverse(handle: QuestionRingMeshes, inv: ActiveInverse, boss: Boss, time: number): void {
  const { x, z } = boss.pos;
  const y = inv.ringHeight ?? QUESTION_RING_DEFAULT_Y;
  updateQuestionRing(handle, x, z, y, time);
}
