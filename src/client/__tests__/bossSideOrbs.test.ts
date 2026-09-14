import { expect, test } from "bun:test";
import { selectBossSideOrbs } from "../render/bossSideOrbs";
import { loadRaid } from "../../engine/raidLoader";
import { createWorld } from "../../engine/world";
import { baseRaid, loadRaid as loadTestRaid, noMove, roster, runTicks } from "../../engine/__tests__/helpers";

const rawRaid = Bun.YAML.parse(await Bun.file(`${import.meta.dir}/../../../raids/forked-tower-magic/fertile-ground.yaml`).text());
const raid = loadRaid(rawRaid);

const HEADS = [1, 2, 3, 4, 5, 6, 7, 8];
const teleportTime = (head: number) => 27.3 + 1.2 * (head - 1);
const beamResolveTime = (head: number) => 42.4 + 6 * (head - 1) + 0.67;
const BRANCH_A = Object.fromEntries(HEADS.map(head => [`event-set-beam-${head}`, 0]));

test("each head reveals both orbs after its own teleport and clears them when its lasers resolve", () => {
  let world = createWorld(raid, 42, BRANCH_A);
  world.players.forEach(player => { player.invincible = true; });
  const at = (time: number) => {
    world = runTicks(world, noMove, Math.ceil((time - world.time) * 60));
    return selectBossSideOrbs(world);
  };

  expect(at(teleportTime(1) - 0.1).size).toBe(0);

  for (const head of HEADS) {
    const orbs = at(teleportTime(head) + 0.05);
    expect([...orbs.keys()]).toEqual(HEADS.slice(0, head).map(n => `head-${n}`));
    expect(orbs.get(`head-${head}`)).toEqual({ leftColor: "#3aa0ff", rightColor: "#a855f7" });
  }

  for (const head of HEADS) {
    expect(at(beamResolveTime(head) - 0.05).has(`head-${head}`)).toBe(true);
    const remaining = at(beamResolveTime(head) + 0.05);
    expect([...remaining.keys()]).toEqual(HEADS.slice(head).map(n => `head-${n}`));
  }
});

test("orb colours follow the selected beam branch", () => {
  for (const [branch, leftColor, rightColor] of [[0, "#3aa0ff", "#a855f7"], [1, "#a855f7", "#3aa0ff"]] as const) {
    const world = runTicks(
      createWorld(raid, 42, { "event-set-beam-1": branch }),
      noMove,
      Math.ceil((teleportTime(1) + 0.05) * 60),
    );
    expect(selectBossSideOrbs(world).get("head-1")).toEqual({ leftColor, rightColor });
  }
});

test("a side drops out on its own when only that laser has resolved", () => {
  const world = runTicks(createWorld(raid, 42, BRANCH_A), noMove, Math.ceil((teleportTime(1) + 0.05) * 60));
  const purple = world.pending.find(event => event.id.startsWith("beam-1-") && event.color === "#a855f7")!;
  world.pending = world.pending.filter(event => event !== purple);
  world.active.push({ ...purple, telegraphStart: purple.t, resolveAt: purple.t, resolved: true } as never);
  expect(selectBossSideOrbs(world).get("head-1")).toEqual({ leftColor: "#3aa0ff" });
});

test("worlds whose AOEs carry no sideOrbAfter select nothing", () => {
  const plain = loadTestRaid({
    ...baseRaid,
    players: roster(),
    events: [{
      id: "cleave", type: "aoe", time: 1, name: "Cleave", telegraph: 1, damage: 0, damageType: "magical",
      color: "#3aa0ff", shape: { kind: "cone", origin: [0, 0], angleDeg: 180, length: 20 },
    }],
  });
  expect(selectBossSideOrbs(createWorld(plain, 1)).size).toBe(0);
});
