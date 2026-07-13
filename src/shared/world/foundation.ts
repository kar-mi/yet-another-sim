import type { Vec2 } from "../math";

export type Role = "tank" | "healer" | "dps";

export type Control = "human" | "bot";

export type Status = "running" | "cleared" | "wiped";

export type ZoneShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "rect"; center: Vec2; width: number; height: number }
  | { kind: "polygon"; vertices: Vec2[] };

export type FloorPlan = "squares" | "dmu-p1" | "dmu-p2";

export type Arena = { zones: ZoneShape[]; floorPlan: FloorPlan };

export type WaymarkId = "A" | "B" | "C" | "D" | "1" | "2" | "3" | "4";
export type Waymark = { mark: WaymarkId; pos: Vec2 };

export type CrystalElement = "wind" | "fire" | "water" | "earth";
export type Crystal = { id: string; element: CrystalElement; pos: Vec2; spawnAt: number };

export type Waypoint = { t: number; pos: Vec2 };

// One ordered, data-driven bot-solver rule (see docs/authoring-bot-patterns.md "Generic solver").
// A rule is active during a matched mechanic's telegraph->resolve window (and/or while a named
// debuff is active), optionally clamped by startAt/endAt. When active it sends each matching bot
// to spots[its id] ?? spot. Conditions in `when` are ANDed.
export type DamageType = "physical" | "magical" | "true";
export type TelegraphMode = "cast" | "resolve";

// Render-only: during the final `lead` seconds before resolve, flash the AoE footprint
// in `color` (hex; defaults to light blue) as a just-in-time tell. Drawn even when
// showTelegraph is false. Does not affect simulation timing or damage.
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
