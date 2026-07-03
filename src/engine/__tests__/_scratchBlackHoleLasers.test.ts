import { expect, test } from "bun:test";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import { createWorld } from "../world";
import { runTicksWithComputedBotIntents } from "./helpers";

for (const cutoff of [66, 67, 68, 69, 70]) {
  test(`scratch ORIGINAL bots: survival check up to t=${cutoff}`, async () => {
    const raidData = Bun.YAML.parse(await Bun.file("raids/dancing-mad-ultimate/black-hole.yaml").text());
    const botData = Bun.YAML.parse(await Bun.file("C:/Users/Rak/AppData/Local/Temp/claude/D--Workspace-yet-another-sim/254a80c9-df0e-4327-9f11-6b839d0540cb/scratchpad/orig-bots.yaml").text());
    const raid = applyBotPatterns(loadRaid(raidData), loadBotPatterns(botData));
    const world = runTicksWithComputedBotIntents(createWorld(raid, 1), Math.ceil(cutoff * 60));
    const dead = world.players.filter(p => !p.alive).map(p => p.id);
    console.log(`ORIGINAL t=${cutoff}: dead=${JSON.stringify(dead)} status=${world.status}`);
  });
}
