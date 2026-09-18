import type { z } from "zod";
import { cos, sin } from "@shared/dmath";
import type { ZoneShapeSchema } from "./raidSchemaFoundation";

type Zone = z.output<typeof ZoneShapeSchema>;

// Named alternatives to an inline `arena.zones` list, for shapes a generator states more clearly
// than yaml can. Dimensions for Index are measured in scripts/raid_analyzer/out/index-timeline.md.
export const ARENA_GENERATORS = {
  index_arena_1: () => indexArena(BASE_EDGES),
  index_arena_2: () => indexArena([...BASE_EDGES, ...EXPANDED_EDGES]),
} as const;

export type ArenaGeneratorId = keyof typeof ARENA_GENERATORS;
export const ARENA_GENERATOR_IDS = Object.keys(ARENA_GENERATORS) as [ArenaGeneratorId, ...ArenaGeneratorId[]];

// Six trapezoids forming a hexagon with a hexagonal hole, plus a square platform on three of the
// six edges. Elementary Expansion (48399) raises the other three; Elementary Absorption (48435)
// drops them again.
const BASE_EDGES = [180, 300, 60];
const EXPANDED_EDGES = [0, 120, 240];
const OUTER_APOTHEM = 13;
const HOLE_APOTHEM = 5.6;

const DEG = Math.PI / 180;
// A hexagon's side equals its circumradius, and the platforms sit flush across a whole edge, so
// their corners land exactly on the hexagon's vertices.
const PLATFORM_SIDE = OUTER_APOTHEM / cos(30 * DEG);
// Edge normals sit at 0/60/120/180/240/300, so the vertices fall between them.
const VERTEX_ANGLES = [30, 90, 150, 210, 270, 330];

// +z is north, +x is east, angles run clockwise from north.
function vertex(angleDeg: number, apothem: number): [number, number] {
  const radius = apothem / cos(30 * DEG);
  const rad = angleDeg * DEG;
  return [radius * sin(rad), radius * cos(rad)];
}

function indexArena(platformEdges: number[]): Zone[] {
  const zones: Zone[] = VERTEX_ANGLES.map((angle, i) => {
    const next = VERTEX_ANGLES[(i + 1) % VERTEX_ANGLES.length]!;
    return {
      kind: "polygon",
      image: "index-trapezoid",
      vertices: [
        vertex(angle, HOLE_APOTHEM),
        vertex(next, HOLE_APOTHEM),
        vertex(next, OUTER_APOTHEM),
        vertex(angle, OUTER_APOTHEM),
      ],
    };
  });

  const half = PLATFORM_SIDE / 2;
  for (const angle of platformEdges) {
    const rad = angle * DEG;
    const along = { x: sin(rad), z: cos(rad) };
    const side = { x: cos(rad), z: -sin(rad) };
    const corner = (radius: number, sign: number): [number, number] => [
      along.x * radius + side.x * half * sign,
      along.z * radius + side.z * half * sign,
    ];
    zones.push({
      kind: "polygon",
      image: "index-square",
      vertices: [
        corner(OUTER_APOTHEM, -1),
        corner(OUTER_APOTHEM, 1),
        corner(OUTER_APOTHEM + PLATFORM_SIDE, 1),
        corner(OUTER_APOTHEM + PLATFORM_SIDE, -1),
      ],
    });
  }

  return zones;
}
