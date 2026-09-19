import { expect, test } from "bun:test";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { AOEShape } from "@effects";
import { sampleShapePoint } from "@effects";
import { createShapeMesh, createShapeOutlineMesh } from "@effects/babylon";

// A rotated instance of every shape, so sampling and geometry are exercised off-axis.
const DIRECTION = { x: 0.6, z: -0.8 };
const SHAPES: Record<string, AOEShape> = {
  circle: { kind: "circle", center: { x: 3, z: -2 }, radius: 4 },
  donut: { kind: "donut", center: { x: -1, z: 5 }, inner: 3, outer: 7 },
  cone: { kind: "cone", origin: { x: 2, z: 2 }, direction: DIRECTION, angleDeg: 70, length: 9 },
  rect: { kind: "rect", origin: { x: -4, z: 1 }, direction: DIRECTION, width: 5, length: 12 },
  polygon: { kind: "polygon", vertices: [{ x: 0, z: 0 }, { x: 6, z: 1 }, { x: 7, z: 8 }, { x: -1, z: 6 }] },
};

const scene = new Scene(new NullEngine());

test.each(Object.keys(SHAPES))("%s builds a filled mesh and an outline", kind => {
  const shape = SHAPES[kind]!;
  const fill = createShapeMesh(scene, `fill-${kind}`, shape);
  const outline = createShapeOutlineMesh(scene, `outline-${kind}`, shape);
  expect(fill).not.toBeNull();
  expect(outline).not.toBeNull();
  for (const mesh of [fill!, outline!]) {
    expect(mesh.getTotalVertices()).toBeGreaterThan(0);
    expect(mesh.getIndices()!.length).toBeGreaterThan(0);
  }
});

test("outlines trace the shape edge rather than filling it", () => {
  // The cone outline closes through its apex, so its extent still reaches the arc.
  const outline = createShapeOutlineMesh(scene, "extent-cone", SHAPES.cone!)!;
  const positions = outline.getVerticesData(VertexBuffer.PositionKind)!;
  let maxY = -Infinity;
  for (let i = 1; i < positions.length; i += 3) maxY = Math.max(maxY, positions[i]!);
  // Outlines sit above the fill plane (y = 0.01) at y = 0.03 plus the tube radius.
  expect(maxY).toBeGreaterThan(0.03);
});

const samples = (shape: AOEShape, n = 3000) => Array.from({ length: n }, () => sampleShapePoint(shape));

test("circle samples stay inside the radius", () => {
  const { center, radius } = SHAPES.circle as Extract<AOEShape, { kind: "circle" }>;
  for (const p of samples(SHAPES.circle!)) {
    expect(Math.hypot(p.x - center.x, p.z - center.z)).toBeLessThanOrEqual(radius + 1e-9);
  }
});

test("donut samples stay in the ring and never fall in the hole", () => {
  const { center, inner, outer } = SHAPES.donut as Extract<AOEShape, { kind: "donut" }>;
  for (const p of samples(SHAPES.donut!)) {
    const d = Math.hypot(p.x - center.x, p.z - center.z);
    expect(d).toBeGreaterThanOrEqual(inner - 1e-9);
    expect(d).toBeLessThanOrEqual(outer + 1e-9);
  }
});

test("cone samples stay within the rotated arc and length", () => {
  const cone = SHAPES.cone as Extract<AOEShape, { kind: "cone" }>;
  const len = Math.hypot(cone.direction.x, cone.direction.z);
  const yaw = Math.atan2(cone.direction.x / len, cone.direction.z / len);
  const half = (cone.angleDeg / 2) * (Math.PI / 180);
  for (const p of samples(cone)) {
    const dx = p.x - cone.origin.x, dz = p.z - cone.origin.z;
    expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(cone.length + 1e-9);
    let delta = Math.atan2(dx, dz) - yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    expect(Math.abs(delta)).toBeLessThanOrEqual(half + 1e-9);
  }
});

test("rect samples stay within the rotated footprint", () => {
  const rect = SHAPES.rect as Extract<AOEShape, { kind: "rect" }>;
  const len = Math.hypot(rect.direction.x, rect.direction.z);
  const dir = { x: rect.direction.x / len, z: rect.direction.z / len };
  const right = { x: dir.z, z: -dir.x };
  for (const p of samples(rect)) {
    const dx = p.x - rect.origin.x, dz = p.z - rect.origin.z;
    const along = dx * dir.x + dz * dir.z;
    const across = dx * right.x + dz * right.z;
    expect(along).toBeGreaterThanOrEqual(-1e-9);
    expect(along).toBeLessThanOrEqual(rect.length + 1e-9);
    expect(Math.abs(across)).toBeLessThanOrEqual(rect.width / 2 + 1e-9);
  }
});

test("polygon samples stay inside the convex hull", () => {
  const { vertices } = SHAPES.polygon as Extract<AOEShape, { kind: "polygon" }>;
  const side = (a: { x: number; z: number }, b: { x: number; z: number }, p: { x: number; z: number }) =>
    (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  for (const p of samples(SHAPES.polygon!)) {
    for (let i = 0; i < vertices.length; i++) {
      expect(side(vertices[i]!, vertices[(i + 1) % vertices.length]!, p)).toBeGreaterThanOrEqual(-1e-9);
    }
  }
});

test("samples cover the whole footprint, not just its centre", () => {
  const rect = SHAPES.rect as Extract<AOEShape, { kind: "rect" }>;
  const points = samples(rect);
  const spanX = Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x));
  const spanZ = Math.max(...points.map(p => p.z)) - Math.min(...points.map(p => p.z));
  // A 5x12 rect rotated off-axis spans well beyond its narrow side on both axes.
  expect(spanX).toBeGreaterThan(5);
  expect(spanZ).toBeGreaterThan(5);
});
