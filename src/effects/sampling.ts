import type { Vec2 } from "@shared/math";
import { normalize } from "@shared/math";
import type { AOEShape } from "./index";

export function sampleShapePoint(shape: AOEShape): Vec2 {
  switch (shape.kind) {
    case "circle": {
      const { x, z } = radial(shape.radius * Math.sqrt(Math.random()), Math.random() * Math.PI * 2);
      return { x: shape.center.x + x, z: shape.center.z + z };
    }

    case "donut": {
      const inner2 = shape.inner * shape.inner;
      const r = Math.sqrt(inner2 + Math.random() * (shape.outer * shape.outer - inner2));
      const { x, z } = radial(r, Math.random() * Math.PI * 2);
      return { x: shape.center.x + x, z: shape.center.z + z };
    }

    case "cone": {
      const dir = normalize(shape.direction);
      const yaw = Math.atan2(dir.x, dir.z);
      const half = (shape.angleDeg / 2) * (Math.PI / 180);
      const angle = yaw - half + Math.random() * 2 * half;
      const r = shape.length * Math.sqrt(Math.random());
      return { x: shape.origin.x + Math.sin(angle) * r, z: shape.origin.z + Math.cos(angle) * r };
    }

    case "rect": {
      const dir = normalize(shape.direction);
      const right = { x: dir.z, z: -dir.x };
      const along = Math.random() * shape.length;
      const across = (Math.random() - 0.5) * shape.width;
      return {
        x: shape.origin.x + dir.x * along + right.x * across,
        z: shape.origin.z + dir.z * along + right.z * across,
      };
    }

    case "polygon": {
      const [origin, ...rest] = shape.vertices;
      if (!origin) return { x: 0, z: 0 };
      const areas = rest.slice(1).map((v, i) => Math.abs(cross(rest[i]!, v, origin)) / 2);
      const total = areas.reduce((sum, area) => sum + area, 0);
      let pick = Math.random() * total;
      let index = areas.findIndex(area => (pick -= area) <= 0);
      if (index < 0) index = areas.length - 1;
      return inTriangle(origin, rest[index]!, rest[index + 1]!);
    }
  }
}

function radial(r: number, angle: number): Vec2 {
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
}

function cross(a: Vec2, b: Vec2, origin: Vec2): number {
  return (a.x - origin.x) * (b.z - origin.z) - (a.z - origin.z) * (b.x - origin.x);
}

function inTriangle(a: Vec2, b: Vec2, c: Vec2): Vec2 {
  let u = Math.random(), v = Math.random();
  if (u + v > 1) { u = 1 - u; v = 1 - v; }
  return {
    x: a.x + u * (b.x - a.x) + v * (c.x - a.x),
    z: a.z + u * (b.z - a.z) + v * (c.z - a.z),
  };
}
