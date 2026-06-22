import { describe, expect, test } from "bun:test";
import { genericFrameNorth } from "../../engine/genericSolver";
import { createWorld } from "../../engine/world";
import { baseRaid, loadRaid } from "../../engine/__tests__/helpers";
import {
  combinePositionFrames,
  invertFramePosition,
  positionFrameOptions,
} from "../frameReadout";

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

  test("a mirrored right axis reads a reflected world position as the same local spot", () => {
    const eastNorth = { x: 9 / Math.sqrt(181), z: 10 / Math.sqrt(181) };
    const westNorth = { x: -9 / Math.sqrt(181), z: 10 / Math.sqrt(181) };
    const eastWorld = {
      x: 3 * eastNorth.z + 4 * eastNorth.x,
      z: -3 * eastNorth.x + 4 * eastNorth.z,
    };
    const westWorld = { x: -eastWorld.x, z: eastWorld.z };

    const east = invertFramePosition(eastWorld, eastNorth, 1);
    const west = invertFramePosition(westWorld, westNorth, -1);
    expect(east.r).toBeCloseTo(3);
    expect(east.z).toBeCloseTo(4);
    expect(west.r).toBeCloseTo(3);
    expect(west.z).toBeCloseTo(4);
  });

  test("combined refs are summed before normalization", () => {
    const initial = createWorld(loadRaid(baseRaid));
    const boss = { ...initial.boss, pos: { x: 1, z: 0 } };
    const world = {
      ...initial,
      boss,
      bosses: [boss],
      crystals: [{
        id: "crystal-fire",
        element: "fire" as const,
        pos: { x: 2, z: 2 },
        spawnAt: 0,
      }],
    };
    const options = positionFrameOptions(world, world.players[0]!);
    const bossOption = options.find(option => option.key === `boss:${boss.id}:facing`)!;
    const crystalOption = options.find(option => option.key === "crystal:fire")!;
    const combined = combinePositionFrames([bossOption, crystalOption], world)!;
    const expected = genericFrameNorth([bossOption.refs![0]!, crystalOption.refs![0]!], world)!;

    expect(combined.north?.x).toBeCloseTo(expected.x);
    expect(combined.north?.z).toBeCloseTo(expected.z);
    expect(combined.north?.x).not.toBeCloseTo((bossOption.north!.x + crystalOption.north!.x) / 2);
    expect(combined.north?.z).not.toBeCloseTo((bossOption.north!.z + crystalOption.north!.z) / 2);
    expect(combined.descriptor).toContain("mirrorLateral: true");
  });

  test("non-ref and mixed selections cannot be combined", () => {
    const world = createWorld(loadRaid(baseRaid));
    const worldOption = positionFrameOptions(world, world.players[0]!)[0]!;
    const bossOption = positionFrameOptions(world, world.players[0]!)
      .find(option => option.key.endsWith(":position"))!;

    expect(combinePositionFrames([worldOption], world)).toBeUndefined();
    expect(combinePositionFrames([worldOption, bossOption], world)).toBeUndefined();
  });
});
