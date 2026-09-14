import { expect, test } from "bun:test";
import { createWorld } from "../../world";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../../raidLoader";
import { runTicksWithComputedBotIntents } from "../helpers";

const RAID_DIR = `${import.meta.dir}/../../../../raids/forked-tower-magic`;
const raidData = Bun.YAML.parse(await Bun.file(`${RAID_DIR}/fertile-ground.yaml`).text());
const botData = Bun.YAML.parse(await Bun.file(`${RAID_DIR}/fertile-ground-bots.yaml`).text());
const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));

test("Fertile Ground bots alternate every head beam while dodging overlapping Ancient III AOEs", () => {
  for (let seed = 1; seed <= 32; seed++) {
    const world = runTicksWithComputedBotIntents(createWorld(raid, seed), Math.ceil(raid.duration * 60));
    expect(world.players.every(player => player.alive)).toBe(true);
    expect(world.log.filter(entry => entry.event === "avoidableHit")).toHaveLength(0);
    expect(world.players.every(player =>
      !player.effects.some(effect => effect.name === "Thrice Come Ruin"))).toBe(true);
  }
});

test("Blizzard and Thunder use short side dodges while only Fire sends bots outward", () => {
  for (let elements = 0; elements < 6; elements++) {
    const world = runTicksWithComputedBotIntents(
      createWorld(raid, 1, { "event-set-elements": elements }),
      Math.ceil(54.9 * 60),
    );
    const radii = world.players.map(player => Math.hypot(player.pos.x, player.pos.z));
    const firstElementIsFire = elements >= 4;
    expect(radii.every(radius => firstElementIsFire ? radius > 14 : radius < 12)).toBe(true);
  }
});
