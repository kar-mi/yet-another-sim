import { expect, test } from "bun:test";
import { computeBotIntents } from "../botIntent";
import { tick } from "../sim";
import { createWorld } from "../world";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../raidLoader";
import { worldHash } from "@shared/worldHash";
import { HUMAN, baseRaid, effect, loadRaid as buildRaid, roster, withPlayerEffect } from "./helpers";
import type { RaidDef } from "../raidSchema";
import type { Intents, World } from "@shared/types";

// Server-relayed lockstep requires that `tick` produce byte-identical worlds from the same seed +
// inputs on every client, and that the entire simulation state live in `World` (so a late joiner
// can resync by replaying). These tests exercise a full, mechanic-heavy fight (graven-image-3 with
// its bot patterns) driven purely by the seeded bot solver.

const DT = 1 / 60;
const SEED = 0x1234abcd;
const DIR = "raids/dancing-mad-ultimate";

async function gravenRaid(): Promise<RaidDef> {
  const raid = loadRaid(Bun.YAML.parse(await Bun.file(`${DIR}/graven-image-3.yaml`).text()));
  const bots = loadBotPatterns(Bun.YAML.parse(await Bun.file(`${DIR}/graven-image-3-bots.yaml`).text()));
  return applyBotPatterns(raid, bots);
}

// Run the fight to completion, hashing the world every 100 ticks. If `roundTripAt` is set, the world
// is serialized through JSON and rehydrated at that tick to prove no hidden state lives outside it.
function replay(raid: RaidDef, roundTripAt?: number): number[] {
  let w = createWorld(raid, SEED);
  const hashes: number[] = [];
  for (let i = 1; i <= 4000 && w.status === "running"; i++) {
    w = tick(w, computeBotIntents(w, DT), DT);
    if (roundTripAt === i) w = JSON.parse(JSON.stringify(w)) as World;
    if (i % 100 === 0) hashes.push(worldHash(w));
  }
  return hashes;
}

test("engine replay is bit-identical across runs (deterministic lockstep)", async () => {
  const raid = await gravenRaid();
  const a = replay(raid);
  expect(a.length).toBeGreaterThan(0);
  expect(replay(raid)).toEqual(a);
});

test("mid-run JSON round-trip leaves the simulation unchanged (state lives in World)", async () => {
  const raid = await gravenRaid();
  expect(replay(raid, 800)).toEqual(replay(raid));
});

// `tick` is a pure function of (seed, inputs), so two worlds built from the same seed and driven by
// identical per-tick intents must stay byte-identical. The graven replay above covers a full
// bot-driven fight; this table adds the seeded/human-driven paths it does not exercise (human input,
// chain break, the plant-rng solver, knockback slide). We compare worldHash (the same simulation
// fingerprint lockstep relies on) rather than JSON, which is order-sensitive and noisy on failure.
const botDriven = (w: World): Intents => ({ ...computeBotIntents(w, DT), [HUMAN]: { move: { x: 0, z: 0 } } });

const determinismCases: { name: string; make: (seed: number) => World; drive: (w: World) => Intents; ticks: number }[] = [
  {
    name: "empty raid under human input",
    make: seed => createWorld(buildRaid(baseRaid), seed),
    drive: () => ({ [HUMAN]: { move: { x: 0.3, z: 0.7 } } }),
    ticks: 200,
  },
  {
    name: "bot intents on a patterned roster",
    make: seed => createWorld(buildRaid({
      ...baseRaid,
      players: roster({ m1: { spawn: [0, 15] }, mt: { spawn: [0, 0], pattern: [{ t: 0, pos: [10, 0] }, { t: 1, pos: [10, 10] }] } }),
    }), seed),
    drive: botDriven,
    ticks: 200,
  },
  {
    name: "chain mechanic with a separating human",
    make: seed => createWorld(buildRaid({
      ...baseRaid,
      arena: { zones: [{ kind: "circle", center: [0, 0], radius: 30 }] },
      players: roster({ m1: { spawn: [0, 0] }, ot: { spawn: [1, 0] } }),
      events: [{ type: "chain", t: 0.1, name: "Chain", pairs: [["m1", "ot"]], telegraph: 0.5, breakWindow: 5, breakDistance: 12, breakDamage: 40, damageType: "magical", debuffName: "Chain Bond" }],
    }), seed),
    drive: () => ({ [HUMAN]: { move: { x: 0.3, z: 0 } } }),
    ticks: 200,
  },
  {
    name: "plant-rng solver",
    make: seed => withPlayerEffect(
      createWorld(applyBotPatterns(
        buildRaid({
          ...baseRaid,
          players: roster({ mt: { spawn: [0, 0] } }),
          optionals: { combinations: { plant: { rng: true, g1: { members: ["mt"], combos: [["down", "down"]] }, g2: { members: ["r1"], combos: [["up", "up"]] } } } },
        }),
        loadBotPatterns({ players: {}, solvers: { generic: [
          { when: { plant: "down down", plantSlot: 0 }, spot: [18, 0] },
          { when: { plant: "down down", plantSlot: 1 }, spot: [0, 18] },
          { when: { plant: "up up", plantSlot: 0 }, spot: [-18, 0] },
          { when: { plant: "up up", plantSlot: 1 }, spot: [0, -18] },
        ] } }),
      ), seed),
      "mt",
      effect({ name: "Plant", behavior: { kind: "plant", direction: [0, -1], distance: 8, radius: 3, armDelay: 3, duration: 10, tpDelay: 1 }, plantSlot: 0 }),
    ),
    drive: botDriven,
    ticks: 120,
  },
  {
    name: "knockback slide under human input",
    make: seed => createWorld(buildRaid({
      ...baseRaid,
      players: roster({ m1: { spawn: [2, 0] } }),
      events: [{ t: 0.1, name: "KB", telegraph: 0.01, damage: 0, damageType: "true", shape: { kind: "circle", center: [0, 0], radius: 10 }, knockback: { distance: 10, height: 4 } }],
    }), seed),
    drive: () => ({ [HUMAN]: { move: { x: 0.2, z: 0.5 } } }),
    ticks: 200,
  },
];

for (const { name, make, drive, ticks } of determinismCases) {
  test(`deterministic: ${name}`, () => {
    let a = make(1);
    let b = make(1);
    for (let i = 0; i < ticks; i++) {
      a = tick(a, drive(a), DT);
      b = tick(b, drive(b), DT);
    }
    expect(worldHash(a)).toBe(worldHash(b));
  });
}
