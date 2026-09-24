import type { Vec2 } from "@shared/math";
import { dot, length, normalize, pointInCircle, pointInPolygon } from "@shared/math";
import type { AOEShape } from "@model/types";
import { cos } from "@shared/dmath";

export function pointInShape(shape: AOEShape, p: Vec2): boolean {
  switch (shape.kind) {
    case "circle":
      return pointInCircle(shape.center, shape.radius, p);

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

    case "polygon":
      return pointInPolygon(shape.vertices, p);
  }
}
