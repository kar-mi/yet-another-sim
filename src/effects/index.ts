import type { Vec2 } from "@shared/math";

export type WaymarkId = "A" | "B" | "C" | "D" | "1" | "2" | "3" | "4";

export type ElementGlyphKind = "lightning" | "fire" | "ice";

export type AOEShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "donut"; center: Vec2; inner: number; outer: number }
  | { kind: "cone"; origin: Vec2; direction: Vec2; angleDeg: number; length: number }
  | { kind: "rect"; origin: Vec2; direction: Vec2; width: number; length: number }
  | { kind: "polygon"; vertices: Vec2[] };

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
  | { kind: "resolve"; lead?: number; trail?: number };

const FLOOR_AOE_DEFAULT_LEAD = 0.5;
const FLOOR_AOE_DEFAULT_TRAIL = 0.2;

export const DEFAULT_DANGER_COLOR = "#ff260d";
export const DEFAULT_STACK_COLOR = "#4db2ff";
export const DEFAULT_INVERTED_COLOR = "#6699ff";
export const DEFAULT_GAZE_NORMAL_COLOR = "#408cff";
export const DEFAULT_GAZE_REVERSE_COLOR = "#ff591a";

export class FloorAoe {
  readonly id: string;
  readonly shape: AOEShape;
  readonly color: string;
  readonly alpha?: number;
  readonly style?: "outline";
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

export function isFloorAoeVisible(aoe: FloorAoe, time: number, resolved: boolean): boolean {
  if (aoe.resolveMode.kind === "active") return !resolved;
  const lead = aoe.resolveMode.lead ?? FLOOR_AOE_DEFAULT_LEAD;
  const trail = aoe.resolveMode.trail ?? FLOOR_AOE_DEFAULT_TRAIL;
  return time >= aoe.resolveAt - lead && time <= aoe.resolveAt + trail;
}

export { sampleShapePoint } from "./sampling";
