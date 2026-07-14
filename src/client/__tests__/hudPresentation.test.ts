import { describe, expect, test } from "bun:test";
import { createWorld } from "../../engine/world";
import { baseRaid, loadRaid, runTicks } from "../../engine/__tests__/helpers";
import { buildCastCandidates, castForBoss } from "../ui/hudPresentation";

describe("boss cast presentation", () => {
  test("maps concurrent casts to their authored bosses and defaults to the primary boss", () => {
    const raid = loadRaid({
      ...baseRaid,
      bosses: [
        { id: "primary", pos: [-5, 0] },
        { id: "secondary", pos: [5, 0] },
      ],
      events: [
        {
          type: "aoe", t: 0, name: "Primary Cast", telegraph: 2, damage: 0, damageType: "true",
          shape: { kind: "circle", center: [0, 0], radius: 1 }, showCastBar: true,
        },
        {
          type: "aoe", t: 0, name: "Secondary Cast", telegraph: 3, damage: 0, damageType: "true",
          shape: { kind: "circle", center: [0, 0], radius: 1 }, bossId: "secondary", showCastBar: true,
        },
        {
          type: "aoe", t: 0, name: "Hidden Cast", telegraph: 3, damage: 0, damageType: "true",
          shape: { kind: "circle", center: [0, 0], radius: 1 }, showCastBar: false,
        },
      ],
    });
    const world = runTicks(createWorld(raid), {}, 1);
    const candidates = buildCastCandidates(world);

    expect(candidates).toHaveLength(2);
    expect(castForBoss("primary", candidates)?.name).toBe("Primary Cast");
    expect(castForBoss("secondary", candidates)?.name).toBe("Secondary Cast");
  });
});
