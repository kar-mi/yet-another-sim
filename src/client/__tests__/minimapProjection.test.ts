import { describe, expect, test } from "bun:test";
import { MINIMAP_ARENA_RADIUS, minimapProjection, projectMinimap } from "../ui/minimapProjection";
import type { ZoneShape } from "@shared/types";

describe("minimap projection", () => {
  test("centers offset circles and maps positive Z north and positive X east", () => {
    const projection = minimapProjection([{ kind: "circle", center: { x: 10, z: -5 }, radius: 20 }])!;
    expect(projectMinimap({ x: 10, z: -5 }, projection)).toEqual({ x: 100, y: 100 });
    expect(projectMinimap({ x: 10, z: 15 }, projection)).toEqual({ x: 100, y: 24 });
    expect(projectMinimap({ x: 30, z: -5 }, projection)).toEqual({ x: 176, y: 100 });
    expect(projectMinimap({ x: 10, z: -25 }, projection)).toEqual({ x: 100, y: 176 });
    expect(projectMinimap({ x: -10, z: -5 }, projection)).toEqual({ x: 24, y: 100 });
  });

  test("fits rectangle corners inside the circular viewport without distorting distances", () => {
    const projection = minimapProjection([{ kind: "rect", center: { x: 0, z: 0 }, width: 40, height: 20 }])!;
    for (const x of [-20, 20]) for (const z of [-10, 10]) {
      const p = projectMinimap({ x, z }, projection);
      expect(Math.hypot(p.x - 100, p.y - 100)).toBeCloseTo(MINIMAP_ARENA_RADIUS);
    }
    const east = projectMinimap({ x: 5, z: 0 }, projection);
    const north = projectMinimap({ x: 0, z: 5 }, projection);
    expect(east.x - 100).toBeCloseTo(100 - north.y);
  });

  test("fits separated circles and polygon vertices using shared bounds", () => {
    const vertices = [{ x: 20, z: -10 }, { x: 40, z: -10 }, { x: 30, z: 20 }];
    const zones: ZoneShape[] = [
      { kind: "circle", center: { x: -20, z: 5 }, radius: 10 },
      { kind: "polygon", vertices },
    ];
    const projection = minimapProjection(zones)!;
    expect(projection.center).toEqual({ x: 5, z: 5 });
    for (const vertex of [...vertices, { x: -30, z: 5 }]) {
      const p = projectMinimap(vertex, projection);
      expect(Math.hypot(p.x - 100, p.y - 100)).toBeLessThanOrEqual(MINIMAP_ARENA_RADIUS + 1e-9);
    }
  });

  test("preserves relative marker positions and does not clamp off-map coordinates", () => {
    const projection = minimapProjection([{ kind: "circle", center: { x: 0, z: 0 }, radius: 20 }])!;
    const waymark = projectMinimap({ x: 10, z: 10 }, projection);
    const player = projectMinimap({ x: 5, z: 5 }, projection);
    expect(player.x - 100).toBeCloseTo((waymark.x - 100) / 2);
    expect(player.y - 100).toBeCloseTo((waymark.y - 100) / 2);
    expect(projectMinimap({ x: 100, z: 0 }, projection).x).toBeGreaterThan(200);
  });

  test("has no projection without usable geometry", () => {
    expect(minimapProjection([])).toBeNull();
    expect(minimapProjection([{ kind: "polygon", vertices: [] }])).toBeNull();
  });
});
