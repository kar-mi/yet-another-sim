// Renderer-independent visual vocabulary: footprint shapes, the FloorAoe telegraph wrapper and the
// authored vfx overrides. See docs/effects-package.md.

import type { Vec2 } from "@shared/math";

export type WaymarkId = "A" | "B" | "C" | "D" | "1" | "2" | "3" | "4";

// Element glyph; label variants can supply kind.
export type ElementGlyphKind = "lightning" | "fire" | "ice";

export type AOEShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "donut"; center: Vec2; inner: number; outer: number }
  | { kind: "cone"; origin: Vec2; direction: Vec2; angleDeg: number; length: number }
  | { kind: "rect"; origin: Vec2; direction: Vec2; width: number; length: number }
  | { kind: "polygon"; vertices: Vec2[] };

// Authoring overrides for the effects an AoE draws. Every field is optional and an omitted one
// keeps the effect's built-in preset; the reference is in docs/authoring-raids.md.
type FloorVfx = {
  element?: boolean;
  intensity?: number;
};

type Range = { min: number; max: number };

export type BurstVfx = {
  enabled?: boolean;
  element?: ElementGlyphKind;
  color?: string;
  count?: number;
  size?: Range;
  lifetime?: Range;
};

export type GlowVfx = {
  enabled?: boolean;
  color?: string;
  intensity?: Range;
  pulsePeriod?: number;
};

export type FloorAoeVfx = { floor?: FloorVfx; burst?: BurstVfx };

export type Vfx = FloorAoeVfx & { glow?: GlowVfx };

export type FloorAoeResolveMode =
  | { kind: "active" }
  // Visible only in a window around resolveAt: [resolveAt - lead, resolveAt + trail].
  // lead defaults to FLOOR_AOE_DEFAULT_LEAD (0.5s), trail to FLOOR_AOE_DEFAULT_TRAIL (0.2s).
  | { kind: "resolve"; lead?: number; trail?: number };

const FLOOR_AOE_DEFAULT_LEAD = 0.5;
const FLOOR_AOE_DEFAULT_TRAIL = 0.2;

// Supplied by the engine construction sites when a mechanic authors no color of its own.
export const DEFAULT_DANGER_COLOR = "#ff260d";     // standard unresolved telegraph red
export const DEFAULT_STACK_COLOR = "#4db2ff";      // "stack here" blue
export const DEFAULT_INVERTED_COLOR = "#6699ff";   // inverse "?" shown-shape / flash-before-resolve blue
export const DEFAULT_GAZE_NORMAL_COLOR = "#408cff";  // carrier cone: honest "look away" eye
export const DEFAULT_GAZE_REVERSE_COLOR = "#ff591a"; // carrier cone: "?" eye (face me)

// Plain data, no instance methods: a FloorAoe has to survive the JSON round-trip that lockstep
// hashing and replay reading put the World through, so visibility lives in isFloorAoeVisible below.
export class FloorAoe {
  readonly id: string;
  readonly shape: AOEShape;
  readonly color: string;
  readonly alpha?: number;
  // "outline" draws only the shape edge instead of a filled footprint.
  readonly style?: "outline";
  // Element pattern drawn over the footprint (render-only).
  readonly element?: ElementGlyphKind;
  readonly vfx?: FloorAoeVfx;
  readonly resolveMode: FloorAoeResolveMode;
  readonly resolveAt: number;

  constructor(params: {
    id: string;
    shape: AOEShape;
    color: string;
    alpha?: number;
    style?: "outline";
    element?: ElementGlyphKind;
    vfx?: FloorAoeVfx;
    resolveMode: FloorAoeResolveMode;
    resolveAt: number;
  }) {
    this.id = params.id;
    this.shape = params.shape;
    this.color = params.color;
    this.alpha = params.alpha;
    this.style = params.style;
    this.element = params.element;
    this.vfx = params.vfx;
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

export { sampleShapePoint } from "./sampling";
