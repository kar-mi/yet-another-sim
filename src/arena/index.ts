import type { Vec2 } from "@shared/math";
import { pointInCircle, pointInPolygon } from "@shared/math";
import type { FloorPlanImage, ZoneImage } from "./assets";

export { arenaAssetManifest } from "./assets";
export { ARENA_GENERATORS } from "./generators";

export type ZoneShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "rect"; center: Vec2; width: number; height: number }
  | { kind: "polygon"; vertices: Vec2[]; image?: ZoneImage };

export type FloorPlan = "squares" | FloorPlanImage | { color: string };
export type Arena = { zones: ZoneShape[]; floorPlan: FloorPlan };

export function isOnFloor(pos: Vec2, zones: ZoneShape[]): boolean {
  return zones.some(zone => {
    switch (zone.kind) {
      case "circle": return pointInCircle(zone.center, zone.radius, pos);
      case "rect": {
        const hw = zone.width / 2;
        const hh = zone.height / 2;
        return pos.x >= zone.center.x - hw && pos.x <= zone.center.x + hw
          && pos.z >= zone.center.z - hh && pos.z <= zone.center.z + hh;
      }
      case "polygon": return pointInPolygon(zone.vertices, pos);
    }
  });
}
