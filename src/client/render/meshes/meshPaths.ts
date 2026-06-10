import { Vector3 } from "@babylonjs/core/Maths/math.vector";

type CircleAxis = "x" | "z";

function circlePoint(cx: number, cz: number, radius: number, y: number, angle: number, axis: CircleAxis): Vector3 {
  return axis === "z"
    ? new Vector3(cx + Math.sin(angle) * radius, y, cz + Math.cos(angle) * radius)
    : new Vector3(cx + Math.cos(angle) * radius, y, cz + Math.sin(angle) * radius);
}

export function circlePath(cx: number, cz: number, radius: number, y: number, segments = 48): Vector3[] {
  const pts: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    pts.push(circlePoint(cx, cz, radius, y, angle, "x"));
  }
  return pts;
}

export function filteredCirclePaths(
  cx: number,
  cz: number,
  radius: number,
  y: number,
  segments: number,
  includeAngle: (angle: number) => boolean,
  axis: CircleAxis = "x",
): Vector3[][] {
  const paths: Vector3[][] = [];
  let run: Vector3[] = [];
  const flush = () => {
    if (run.length >= 2) paths.push(run);
    run = [];
  };
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    if (!includeAngle(angle)) {
      flush();
      continue;
    }
    run.push(circlePoint(cx, cz, radius, y, angle, axis));
  }
  flush();
  return paths;
}
