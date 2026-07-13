// The single constructor for a visualized floor AoE (circle/donut/cone/rect telegraph). Any
// mechanic that needs to draw a floor shape builds one of these; the underlying AOEShape stays on
// the mechanic itself for hit-testing/knockback-origin, this is purely the render-facing wrapper
// (shape + color + when it's visible relative to resolution).
//
// Kept as a plain-data class (no instance methods): World is JSON.stringify'd for lockstep hashing
// (shared/worldHash.ts) and JSON.parse'd back out of replay files (server/replayReader.ts), so a
// FloorAoe embedded in World state must still work after a JSON round-trip loses its prototype.
// Visibility logic therefore lives in the standalone isFloorAoeVisible function below, not a method.

import type { AOEShape } from "./types";

export type FloorAoeResolveMode =
  | { kind: "active" }
  // Visible only in a window around resolveAt: [resolveAt - lead, resolveAt + trail].
  // lead defaults to FLOOR_AOE_DEFAULT_LEAD (0.5s), trail to FLOOR_AOE_DEFAULT_TRAIL (0.2s).
  | { kind: "resolve"; lead?: number; trail?: number };

const FLOOR_AOE_DEFAULT_LEAD = 0.5;
const FLOOR_AOE_DEFAULT_TRAIL = 0.2;

// Default colors, matching the conventions each render layer used to hardcode. `color` is required
// on FloorAoe itself (no implicit convention inside the class or the renderer); these are supplied
// explicitly by the engine construction sites when a mechanic doesn't author its own override, so
// existing raid content keeps its current look without needing a mass content migration.
export const DEFAULT_DANGER_COLOR = "#ff260d";     // standard unresolved telegraph red
export const DEFAULT_STACK_COLOR = "#4db2ff";      // "stack here" blue
export const DEFAULT_INVERTED_COLOR = "#6699ff";   // inverse "?" shown-shape / flash-before-resolve blue
export const DEFAULT_GAZE_NORMAL_COLOR = "#408cff";  // carrier cone: honest "look away" eye
export const DEFAULT_GAZE_REVERSE_COLOR = "#ff591a"; // carrier cone: "?" eye (face me)

export class FloorAoe {
  readonly id: string;
  readonly shape: AOEShape;
  readonly color: string;
  readonly alpha?: number;
  readonly resolveMode: FloorAoeResolveMode;
  readonly resolveAt: number;

  constructor(params: {
    id: string;
    shape: AOEShape;
    color: string;
    alpha?: number;
    resolveMode: FloorAoeResolveMode;
    resolveAt: number;
  }) {
    this.id = params.id;
    this.shape = params.shape;
    this.color = params.color;
    this.alpha = params.alpha;
    this.resolveMode = params.resolveMode;
    this.resolveAt = params.resolveAt;
  }
}

// "active" mode is visible for as long as the mechanic hasn't resolved. "resolve" mode is visible
// only in the lead/trail window around resolveAt, independent of the resolved flag (so it can show
// before resolution and briefly linger after, e.g. for casts whose target is chosen at resolve time).
export function isFloorAoeVisible(aoe: FloorAoe, time: number, resolved: boolean): boolean {
  if (aoe.resolveMode.kind === "active") return !resolved;
  const lead = aoe.resolveMode.lead ?? FLOOR_AOE_DEFAULT_LEAD;
  const trail = aoe.resolveMode.trail ?? FLOOR_AOE_DEFAULT_TRAIL;
  return time >= aoe.resolveAt - lead && time <= aoe.resolveAt + trail;
}
