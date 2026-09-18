import type { Vec2 } from "../math";

export type Role = "tank" | "healer" | "dps";

export type Control = "human" | "bot";

export type Status = "running" | "cleared" | "wiped";

// Top-down art for one zone, named here and resolved to a URL by the renderer (like FloorPlan).
export type ZoneImage = "index-trapezoid" | "index-square";

export type ZoneShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "rect"; center: Vec2; width: number; height: number }
  | { kind: "polygon"; vertices: Vec2[]; image?: ZoneImage };

export type FloorPlan = "squares" | "dmu-p1" | "dmu-p2" | { color: string };

export type Arena = { zones: ZoneShape[]; floorPlan: FloorPlan };

export type WaymarkId = "A" | "B" | "C" | "D" | "1" | "2" | "3" | "4";
export type Waymark = { mark: WaymarkId; pos: Vec2 };

export type CrystalElement = "wind" | "fire" | "water" | "earth";
export type Crystal = { id: string; element: CrystalElement; pos: Vec2; spawnAt: number };

export type Waypoint = { t: number; pos: Vec2 };

export type DamageType = "physical" | "magical" | "true";
export type TelegraphMode = "cast" | "resolve";
export type FlashBeforeResolve = { lead: number; color?: string };

export type AOEShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "donut"; center: Vec2; inner: number; outer: number }
  | { kind: "cone"; origin: Vec2; direction: Vec2; angleDeg: number; length: number }
  | { kind: "rect"; origin: Vec2; direction: Vec2; width: number; length: number };

// Arc relative to the boss's facing (radians). A directional attack only hits players whose
// bearing from the boss is within `width/2` of `center`. center is measured clockwise from the
// facing direction: 0 = front, π = rear, π/2 = boss's right, -π/2 = left, π/4 = front-right, etc.
export type PositionalArc = { center: number; width: number };
export type BossRelativeCenter = { lateral: number; forward: number };
export type MechanicSection = { id: string; name: string; t: number };
