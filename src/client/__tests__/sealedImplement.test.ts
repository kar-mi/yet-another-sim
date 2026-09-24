import { expect, test } from "bun:test";
import { selectSealedImplement } from "../render/sealedImplement";
import { loadRaid } from "../../engine/schema/raidLoader";
import { createWorld } from "../../engine/world";
import { noMove, runTicks } from "../../engine/__tests__/helpers";

const rawRaid = Bun.YAML.parse(await Bun.file(`${import.meta.dir}/../../../raids/forked-tower-magic/omni-elements-1.yaml`).text());
const raid = loadRaid(rawRaid);

test("the chosen implement is selected only while its Sealed Implements cast is up", () => {
  for (const [value, kind] of [[0, "bow"], [1, "harp"]] as const) {
    let world = createWorld(raid, 3, { "event-set-implement-1": value, "event-set-implement-2": 1 - value });
    world.players.forEach(player => { player.invincible = true; });
    const at = (time: number) => {
      world = runTicks(world, noMove, Math.ceil((time - world.time) * 60));
      return selectSealedImplement(world.active)?.weapon ?? null;
    };
    const other = kind === "bow" ? "harp" : "bow";

    expect(at(31.4)).toBeNull();
    expect(at(31.6)).toBe(kind);
    expect(at(37.6)).toBe(kind);
    expect(at(37.8)).toBeNull();
    expect(at(45.9)).toBe(other);
    expect(at(52)).toBeNull();
  }
});
