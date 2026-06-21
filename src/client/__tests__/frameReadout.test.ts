import { describe, expect, test } from "bun:test";
import { invertFramePosition } from "../frameReadout";

describe("frame position readout", () => {
  test("north-facing frame preserves world coordinates", () => {
    const result = invertFramePosition({ x: 3, z: 4 }, { x: 0, z: 1 });
    expect(result.r).toBeCloseTo(3);
    expect(result.z).toBeCloseTo(4);
    expect(result.dist).toBeCloseTo(5);
    expect(result.angleDeg).toBeCloseTo(36.8698976);
  });

  test("east-facing frame rotates world position into lateral and forward axes", () => {
    const result = invertFramePosition({ x: 3, z: 4 }, { x: 1, z: 0 });
    expect(result.r).toBeCloseTo(-4);
    expect(result.z).toBeCloseTo(3);
    expect(result.dist).toBeCloseTo(5);
    expect(result.angleDeg).toBeCloseTo(-53.1301024);
  });
});
