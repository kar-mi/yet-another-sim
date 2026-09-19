import type { Vec2 } from "../math";

export type { AOEShape, ElementGlyphKind, WaymarkId } from "@effects";
import type { ElementGlyphKind, WaymarkId } from "@effects";
export type { CrystalElement, DamageType } from "@status";
import type { CrystalElement } from "@status";

export type Role = "tank" | "healer" | "dps";

export type Control = "human" | "bot";

export type Status = "running" | "cleared" | "wiped";

// Zone art resolved by the renderer.
export type ZoneImage = "index-trapezoid" | "index-square";

export type ZoneShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "rect"; center: Vec2; width: number; height: number }
  | { kind: "polygon"; vertices: Vec2[]; image?: ZoneImage };

export type FloorPlan = "squares" | "dmu-p1" | "dmu-p2" | { color: string };

export type Arena = { zones: ZoneShape[]; floorPlan: FloorPlan };

export type Waymark = { mark: WaymarkId; pos: Vec2 };

export type ElementGlyph = { at: Vec2; kind?: ElementGlyphKind };
// Visual ring expanding during a cast.
export type ElementRing = { center: Vec2; radius: number; kind?: ElementGlyphKind };
// Wait at from until departAt, then reach the shape center at resolve.
export type Mover = { from: Vec2; departAt: number; scale?: number; sprite?: boolean };
export type Crystal = { id: string; element: CrystalElement; pos: Vec2; spawnAt: number };

export type Waypoint = { t: number; pos: Vec2 };

export type TelegraphMode = "cast" | "resolve";
export type FlashBeforeResolve = { lead: number; color?: string };

// Arc relative to the boss's facing (radians). A directional attack only hits players whose
// bearing from the boss is within `width/2` of `center`. center is measured clockwise from the
// facing direction: 0 = front, π = rear, π/2 = boss's right, -π/2 = left, π/4 = front-right, etc.
export type PositionalArc = { center: number; width: number };
export type BossRelativeCenter = { lateral: number; forward: number };
export type MechanicSection = { id: string; name: string; t: number };
