import { expect, test } from "bun:test";
import { ARENA_GENERATORS, isOnFloor } from "@arena";

// +z north, +x east, clockwise from north.
function at(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: radius * Math.sin(rad), z: radius * Math.cos(rad) };
}

const base = ARENA_GENERATORS.index_arena_1();
const expanded = ARENA_GENERATORS.index_arena_2();

const BASE_EDGES = [180, 300, 60];
const EXPANDED_EDGES = [0, 120, 240];
const VERTICES = [30, 90, 150, 210, 270, 330];
const OUTER_APOTHEM = 13;
const HOLE_APOTHEM = 5.6;
const toCircumradius = (apothem: number) => apothem / Math.cos(Math.PI / 6);
const PLATFORM_SIDE = toCircumradius(OUTER_APOTHEM); // flush with the hexagon edge

test("six trapezoids plus one square per raised edge", () => {
  expect(base).toHaveLength(9);
  expect(expanded).toHaveLength(12);
});

test("the hole is a hexagon, not a circle", () => {
  expect(isOnFloor({ x: 0, z: 0 }, base)).toBe(false);
  for (const angle of EXPANDED_EDGES.concat(BASE_EDGES)) {
    expect(isOnFloor(at(angle, HOLE_APOTHEM - 0.1), base)).toBe(false);
    expect(isOnFloor(at(angle, HOLE_APOTHEM + 0.1), base)).toBe(true);
  }
  // Toward a vertex the hole reaches further out than the apothem.
  for (const angle of VERTICES) {
    expect(isOnFloor(at(angle, toCircumradius(HOLE_APOTHEM) - 0.1), base)).toBe(false);
    expect(isOnFloor(at(angle, toCircumradius(HOLE_APOTHEM) + 0.1), base)).toBe(true);
  }
});

test("the hub is a hexagon", () => {
  // Check the hexagon’s vertex radius and mid-edge apothem.
  for (const angle of VERTICES) {
    expect(isOnFloor(at(angle, toCircumradius(OUTER_APOTHEM) - 0.1), base)).toBe(true);
  }
  for (const angle of EXPANDED_EDGES) {
    expect(isOnFloor(at(angle, OUTER_APOTHEM - 0.1), base)).toBe(true);
    expect(isOnFloor(at(angle, OUTER_APOTHEM + 0.1), base)).toBe(false);
  }
});

test("the ring is continuous across every trapezoid seam", () => {
  for (const zones of [base, expanded]) {
    for (let angle = 0; angle < 360; angle += 1) {
      // 7 clears the hole's circumradius (6.47) at every angle; 12 stays inside the apothem.
      expect(isOnFloor(at(angle, 7), zones)).toBe(true);
      expect(isOnFloor(at(angle, 12), zones)).toBe(true);
    }
  }
});

test("index_arena_1 raises only S, NW and NE", () => {
  for (const angle of BASE_EDGES) {
    expect(isOnFloor(at(angle, 20), base)).toBe(true);
    expect(isOnFloor(at(angle, 26.5), base)).toBe(true);
  }
  for (const angle of EXPANDED_EDGES) {
    expect(isOnFloor(at(angle, 20), base)).toBe(false);
    expect(isOnFloor(at(angle, 26.5), base)).toBe(false);
  }
});

test("index_arena_2 raises all six edges", () => {
  for (const angle of [...BASE_EDGES, ...EXPANDED_EDGES]) {
    expect(isOnFloor(at(angle, 20), expanded)).toBe(true);
    expect(isOnFloor(at(angle, 26.5), expanded)).toBe(true);
  }
  // Platforms sit on edges, never on the vertices between them.
  for (const angle of VERTICES) {
    expect(isOnFloor(at(angle, 20), expanded)).toBe(false);
  }
});

test("platforms are flush with the hexagon edge, reaching r=28", () => {
  for (const angle of BASE_EDGES) {
    const rad = (angle * Math.PI) / 180;
    const along = { x: Math.sin(rad), z: Math.cos(rad) };
    const side = { x: Math.cos(rad), z: -Math.sin(rad) };
    const point = (radius: number, offset: number) => ({
      x: along.x * radius + side.x * offset,
      z: along.z * radius + side.z * offset,
    });
    for (const sign of [-1, 1]) {
      expect(isOnFloor(point(22, (PLATFORM_SIDE / 2 - 0.1) * sign), base)).toBe(true);
      expect(isOnFloor(point(22, (PLATFORM_SIDE / 2 + 0.1) * sign), base)).toBe(false);
    }
    expect(isOnFloor(point(OUTER_APOTHEM + PLATFORM_SIDE - 0.1, 0), base)).toBe(true);
    expect(isOnFloor(point(OUTER_APOTHEM + PLATFORM_SIDE + 0.1, 0), base)).toBe(false);
    // Walking from the hub onto the platform never crosses a gap.
    for (let r = 11; r <= 16; r += 0.1) expect(isOnFloor(at(angle, r), base)).toBe(true);
  }
});
