export type Vec2 = { x: number; z: number };

export function vec2(x: number, z: number): Vec2 { return { x, z }; }

export function add(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, z: a.z + b.z }; }

export function scale(v: Vec2, s: number): Vec2 { return { x: v.x * s, z: v.z * s }; }

export function length(v: Vec2): number { return Math.sqrt(v.x * v.x + v.z * v.z); }

export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  if (len === 0) return { x: 0, z: 0 };
  return { x: v.x / len, z: v.z / len };
}

export function dot(a: Vec2, b: Vec2): number { return a.x * b.x + a.z * b.z; }
