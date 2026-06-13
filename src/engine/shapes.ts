import type { Vec2 } from "@shared/math";
import { dot, length, normalize } from "@shared/math";
import type { AOEShape, ZoneShape } from "@shared/types";
import { cos } from "@shared/dmath";

function circleContains(center: Vec2, radius: number, p: Vec2): boolean {
  const dx = p.x - center.x;
  const dz = p.z - center.z;
  return dx * dx + dz * dz <= radius * radius;
}

export function pointInShape(shape: AOEShape, p: Vec2): boolean {
  switch (shape.kind) {
    case "circle":
      return circleContains(shape.center, shape.radius, p);

    case "donut": {
      const dx = p.x - shape.center.x;
      const dz = p.z - shape.center.z;
      const d2 = dx * dx + dz * dz;
      return d2 >= shape.inner * shape.inner && d2 <= shape.outer * shape.outer;
    }

    case "cone": {
      const dir = normalize(shape.direction);
      const dx = p.x - shape.origin.x;
      const dz = p.z - shape.origin.z;
      const dist = length({ x: dx, z: dz });
      if (dist > shape.length || dist === 0) return false;
      const pDir = { x: dx / dist, z: dz / dist };
      const cosHalf = cos((shape.angleDeg / 2) * (Math.PI / 180));
      return dot(dir, pDir) >= cosHalf;
    }

    case "rect": {
      const dir = normalize(shape.direction);
      const perp = { x: -dir.z, z: dir.x };
      const dx = p.x - shape.origin.x;
      const dz = p.z - shape.origin.z;
      const fwd = dot({ x: dx, z: dz }, dir);
      const side = Math.abs(dot({ x: dx, z: dz }, perp));
      return fwd >= 0 && fwd <= shape.length && side <= shape.width / 2;
    }
  }
}

export function isOnFloor(pos: Vec2, zones: ZoneShape[]): boolean {
  for (const zone of zones) {
    switch (zone.kind) {
      case "circle":
        if (circleContains(zone.center, zone.radius, pos)) return true;
        break;

      case "rect": {
        const hw = zone.width / 2;
        const hh = zone.height / 2;
        if (
          pos.x >= zone.center.x - hw && pos.x <= zone.center.x + hw &&
          pos.z >= zone.center.z - hh && pos.z <= zone.center.z + hh
        ) return true;
        break;
      }

      case "polygon": {
        const { vertices } = zone;
        let inside = false;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
          const xi = vertices[i].x, zi = vertices[i].z;
          const xj = vertices[j].x, zj = vertices[j].z;
          if (zi > pos.z !== zj > pos.z && pos.x < ((xj - xi) * (pos.z - zi)) / (zj - zi) + xi) {
            inside = !inside;
          }
        }
        if (inside) return true;
        break;
      }
    }
  }
  return false;
}
