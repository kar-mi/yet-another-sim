import { expect, test } from "bun:test";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../../raidLoader";
import { createWorld } from "../../world";
import { runTicksWithComputedBotIntents } from "../helpers";

const raid = applyBotPatterns(
  loadRaid(Bun.YAML.parse(await Bun.file("raids/forked-tower-magic/omni-elements-1.yaml").text())),
  loadBotPatterns(Bun.YAML.parse(await Bun.file("raids/forked-tower-magic/omni-elements-1-bots.yaml").text())),
);

// Expect only raidwides and one Chemistry hit per element; any extra damage fails.
const EXPECTED_DAMAGE = 20 + 3 * 10 + 45;

const variants: Record<string, number>[] = [];
for (const implement1 of [0, 1]) {
  for (const implement2 of [0, 1]) {
    for (const orbs of [0, 1, 2]) {
      for (const chemistry of [0, 1]) {
        variants.push({
          "event-set-implement-1": implement1,
          "event-set-implement-2": implement2,
          "event-set-orbs": orbs,
          "event-set-chemistry": chemistry,
        });
      }
    }
  }
}

variants.forEach((constraints, i) => {
  test(`bots clear Omni-Elements 1: ${JSON.stringify(constraints)}`, () => {
    for (const seed of [i + 1, i + 101]) {
      const end = runTicksWithComputedBotIntents(createWorld(raid, seed, constraints), 81 * 60);
      expect(end.players.map(p => `${p.id} ${p.alive} ${p.maxHp - p.hp}`), `seed ${seed}`)
        .toEqual(end.players.map(p => `${p.id} true ${EXPECTED_DAMAGE}`));
    }
  });
});

test("bots share the home seam spot between waves and the N pad before Chemistry", () => {
  let world = runTicksWithComputedBotIntents(createWorld(raid, 7), 10 * 60);
  for (const player of world.players) {
    expect(Math.abs(player.pos.x - 4.071) + Math.abs(player.pos.z - 10.051)).toBeLessThan(0.2);
  }
  world = runTicksWithComputedBotIntents(world, 48.7 * 60);
  for (const player of world.players) {
    expect(Math.abs(player.pos.x) + Math.abs(player.pos.z - 9)).toBeLessThan(0.2);
  }
});
