// Pure transforms from raw RaidDef event geometry (tuples) into engine types (Vec2 objects).
// Shared by createWorld (arena/waymarks/etc.) and the mechanic registry's per-event bucketing.

import type { AOEShape, Knockback } from "@shared/types";
import { vec2 } from "@shared/math";
import type { RaidDef } from "./raidSchema";

export function toVec2(arr: [number, number]) {
  return vec2(arr[0], arr[1]);
}

type AOEEventDef = Extract<RaidDef["events"][number], { type: "aoe" }>;

export function toAOEShape(shape: AOEEventDef["shape"]): AOEShape {
  switch (shape.kind) {
    case "circle": return { kind: "circle", center: toVec2(shape.center), radius: shape.radius };
    case "donut": return { kind: "donut", center: toVec2(shape.center), inner: shape.inner, outer: shape.outer };
    case "cone": return { kind: "cone", origin: toVec2(shape.origin), direction: toVec2(shape.direction), angleDeg: shape.angleDeg, length: shape.length };
    case "rect": return { kind: "rect", origin: toVec2(shape.origin), direction: toVec2(shape.direction), width: shape.width, length: shape.length };
  }
}

export function toKnockback(kb: { distance: number; height: number; origin?: [number, number] }): Knockback {
  return { distance: kb.distance, height: kb.height, origin: kb.origin ? toVec2(kb.origin) : undefined };
}
