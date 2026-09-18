import type { StatusEffect } from "./types";

// Slices left in an effect's countdown pie at `time`: all of them until `delay` seconds after it
// lands, then one fewer at the end of each following second, so the last slice goes at
// `delay + slices`.
export function countdownSlicesLeft(effect: Pick<StatusEffect, "appliedAt" | "countdown">, time: number): number {
  const countdown = effect.countdown;
  if (!countdown) return 0;
  const drained = Math.max(0, Math.floor(time - effect.appliedAt - countdown.delay));
  return Math.max(0, countdown.slices - drained);
}
