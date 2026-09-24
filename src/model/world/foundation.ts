import type { Vec2 } from "@shared/math";

export type { Arena, ZoneShape } from "@arena";
export type { AOEShape, ElementGlyphKind, WaymarkId } from "@effects";
import type { ElementGlyphKind, WaymarkId } from "@effects";
export type { CrystalElement, DamageType } from "@status";
import type { CrystalElement } from "@status";

export type Role = "tank" | "healer" | "dps";

export type Control = "human" | "bot";

export type Status = "running" | "cleared" | "wiped";

export type Waymark = { mark: WaymarkId; pos: Vec2 };

export type ElementGlyph = { at: Vec2; kind?: ElementGlyphKind };
export type ElementRing = { center: Vec2; radius: number; kind?: ElementGlyphKind };
export type Mover = { from: Vec2; departAt: number; scale?: number; sprite?: boolean };
export type Crystal = { id: string; element: CrystalElement; pos: Vec2; spawnAt: number };

export type Waypoint = { t: number; pos: Vec2 };

export type TelegraphMode = "cast" | "resolve";
export type FlashBeforeResolve = { lead: number; color?: string };

export type PositionalArc = { center: number; width: number };
export type BossRelativeCenter = { lateral: number; forward: number };
export type MechanicSection = { id: string; name: string; t: number };
