import type { Vec2 } from "@shared/math";
import type { ZoneShape } from "@model/types";

export interface MinimapProjection { center: Vec2; scale: number }
export const MINIMAP_ARENA_RADIUS = 76;

function corners(zone: Exclude<ZoneShape, { kind: "circle" }>): Vec2[] {
  if (zone.kind === "polygon") return zone.vertices;
  return [-1, 1].flatMap(x => [-1, 1].map(z => ({
    x: zone.center.x + x * zone.width / 2,
    z: zone.center.z + z * zone.height / 2,
  })));
}

export function minimapProjection(zones: ZoneShape[]): MinimapProjection | null {
  const bounds = zones.flatMap(zone => zone.kind === "circle" ? [
    { x: zone.center.x - zone.radius, z: zone.center.z - zone.radius },
    { x: zone.center.x + zone.radius, z: zone.center.z + zone.radius },
  ] : corners(zone));
  if (!bounds.length) return null;
  const center = {
    x: (Math.min(...bounds.map(p => p.x)) + Math.max(...bounds.map(p => p.x))) / 2,
    z: (Math.min(...bounds.map(p => p.z)) + Math.max(...bounds.map(p => p.z))) / 2,
  };
  const distance = (p: Vec2) => Math.hypot(p.x - center.x, p.z - center.z);
  const radius = Math.max(...zones.flatMap(zone => zone.kind === "circle"
    ? [distance(zone.center) + zone.radius] : corners(zone).map(distance)));
  return radius > 0 ? { center, scale: MINIMAP_ARENA_RADIUS / radius } : null;
}

export function projectMinimap(position: Vec2, projection: MinimapProjection): { x: number; y: number } {
  return {
    x: 100 + (position.x - projection.center.x) * projection.scale,
    y: 100 - (position.z - projection.center.z) * projection.scale,
  };
}
