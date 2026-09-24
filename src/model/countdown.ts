import type { StatusEffect } from "./types";

export function countdownSlicesLeft(effect: Pick<StatusEffect, "appliedAt" | "countdown">, time: number): number {
  const countdown = effect.countdown;
  if (!countdown) return 0;
  const drained = Math.max(0, Math.floor(time - effect.appliedAt - countdown.delay));
  return Math.max(0, countdown.slices - drained);
}
