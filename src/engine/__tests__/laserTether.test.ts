import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { DPS_HP, TANK_HP } from "./constants";
import { baseRaid, byId, loadRaid, noMove, roster, runTicks } from "./helpers";

function run(events: unknown[], players = roster()) {
  return runTicks(createWorld(loadRaid({ ...baseRaid, duration: 3, players, events })), noMove, Math.ceil(1 * 60));
}

test("laser tether beam hits players inside the rect and misses players outside", () => {
  const world = run([{
    type: "tether_source",
    t: 0,
    name: "Black Hole Laser",
    pos: [0, -18],
    finalizeAfter: 0.1,
    tetherKind: "debuff",
    buffName: "Laser Marker",
    applyTetherEffect: false,
    beam: { width: 2, length: 40, damage: 10, applyEffect: { ref: "unbecoming" } },
  }], roster({
    mt: { spawn: [0, -10] },
    h1: { spawn: [0, 0] },
    m1: { spawn: [3, 0] },
  }));

  expect(byId(world, "mt").hp).toBe(TANK_HP - 10);
  expect(byId(world, "h1").hp).toBe(90);
  expect(byId(world, "m1").hp).toBe(DPS_HP);
  expect(byId(world, "mt").effects.some(e => e.name === "Unbecoming")).toBe(true);
  expect(byId(world, "h1").effects.some(e => e.name === "Unbecoming")).toBe(true);
  expect(byId(world, "m1").effects.some(e => e.name === "Unbecoming")).toBe(false);
  expect(byId(world, "mt").effects.some(e => e.name === "Laser Marker")).toBe(false);
});

test("third laser on a Primordial Crust carrier leaves them at 1 HP and cleansed", () => {
  const world = run([
    { type: "apply_effect", t: 0, name: "Crust", players: ["m1"], applyEffect: { ref: "primordial_crust" } },
    ...[0.1, 0.3, 0.5].map((t, i) => ({
      type: "tether_source",
      id: `laser-${i}`,
      t,
      name: `Laser ${i + 1}`,
      pos: [0, -18],
      finalizeAfter: 0.05,
      tetherKind: "debuff",
      buffName: "Laser Marker",
      applyTetherEffect: false,
      beam: { width: 2, length: 40, damage: 10, pointing: [0, 1], applyEffect: { ref: "unbecoming" } },
    })),
  ], roster({ mt: { spawn: [0, -10] }, m1: { spawn: [0, 0] } }));

  expect(byId(world, "m1").alive).toBe(true);
  expect(byId(world, "m1").hp).toBe(1);
  expect(byId(world, "m1").effects.map(e => e.name)).toEqual([]);
});

test("laser-tether demo raid loads without error", async () => {
  const text = await Bun.file(`${import.meta.dir}/../../../raids/debug/laser-tether-test.yaml`).text();
  const yaml = Bun.YAML.parse(text);
  expect(() => loadRaid(yaml)).not.toThrow();
});
