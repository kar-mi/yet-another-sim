import { cos, sin } from "@shared/dmath";
import type { ZoneShape } from "./index";

// Generated arena layouts; Index dimensions come from raid_analyzer measurements.
export const ARENA_GENERATORS = {
  index_arena_1: () => indexArena(BASE_EDGES),
  index_arena_2: () => indexArena([...BASE_EDGES, ...EXPANDED_EDGES]),
} as const;

export type ArenaGeneratorId = keyof typeof ARENA_GENERATORS;
export const ARENA_GENERATOR_IDS = Object.keys(ARENA_GENERATORS) as [ArenaGeneratorId, ...ArenaGeneratorId[]];

const BASE_EDGES = [180, 300, 60];
const EXPANDED_EDGES = [0, 120, 240];
const OUTER_APOTHEM = 13;
const HOLE_APOTHEM = 5.6;
const DEG = Math.PI / 180;
const PLATFORM_SIDE = OUTER_APOTHEM / cos(30 * DEG);
const VERTEX_ANGLES = [30, 90, 150, 210, 270, 330];

function vertex(angleDeg: number, apothem: number) {
  const radius = apothem / cos(30 * DEG);
  const rad = angleDeg * DEG;
  return { x: radius * sin(rad), z: radius * cos(rad) };
}

function indexArena(platformEdges: number[]): ZoneShape[] {
  const zones: ZoneShape[] = VERTEX_ANGLES.map((angle, i) => {
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
    const corner = (radius: number, sign: number) => ({
      x: along.x * radius + side.x * half * sign,
      z: along.z * radius + side.z * half * sign,
    });
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
