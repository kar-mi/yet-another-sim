import { expect, test } from "bun:test";
import { tick } from "../sim";
import { createWorld } from "../world";
import { HUMAN, baseRaid, human, loadRaid, roster, runTicks } from "./helpers";
import type { Vec } from "./helpers";

// --- Line links -----------------------------------------------------------

const lineLinkEvent = (overrides: Record<string, unknown> = {}) => ({
  type: "line_link" as const,
  t: 0.1,
  name: "North Statue",
  pos: [0, 20] as Vec,
  resolveAfter: 0.5,
  target: { roles: ["dps"] },
  hiddenDebuffName: "Line Linked",
  ...overrides,
});

test("line_link applies a hidden debuff to the selected role-filtered target", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ mt: { spawn: [0, 19] }, r1: { spawn: [10, -10] }, r2: { spawn: [-10, -10] }, m1: { spawn: [0, 10] }, m2: { spawn: [0, -10] } }),
    events: [lineLinkEvent()],
  });

  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 20);
  expect(world.lineLinks[0].targetPlayerIds).toEqual([HUMAN]);
  expect(human(world).effects.some(e => e.name === "Line Linked" && e.visibility === "invisible")).toBe(true);
  expect(world.players.find(p => p.id === "mt")!.effects.some(e => e.name === "Line Linked")).toBe(false);
});

test("line_link can restrict targeting to explicit player ids", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ r1: { spawn: [0, 19] }, m1: { spawn: [0, 10] } }),
    events: [lineLinkEvent({ target: { playerIds: [HUMAN] } })],
  });

  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 20);
  expect(world.lineLinks[0].targetPlayerIds).toEqual([HUMAN]);
});

test("line_link can send four visual links, hide them early, and keep hidden debuffs until resolve", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({
      r1: { spawn: [0, 19] },
      r2: { spawn: [2, 18] },
      m1: { spawn: [-2, 18] },
      m2: { spawn: [0, 17] },
    }),
    events: [lineLinkEvent({
      target: { roles: ["dps"], count: 4 },
      linkDuration: 0.1,
      resolveAfter: 1,
    })],
  });

  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 20);
  const link = world.lineLinks[0];
  expect(link.targetPlayerIds).toHaveLength(4);
  expect(link.linkUntil).toBeLessThan(world.time);
  expect(link.resolved).toBe(false);
  for (const id of ["r1", "r2", "m1", "m2"]) {
    expect(world.players.find(p => p.id === id)!.effects.some(e => e.name === "Line Linked" && e.visibility === "invisible")).toBe(true);
  }
});

test("line_link roleGroups can rng and linked line_link takes the complement", () => {
  const raid = loadRaid({
    ...baseRaid,
    events: [
      lineLinkEvent({
        id: "sleep-statue",
        name: "Sleep Statue",
        rng: true,
        target: { roleGroups: [["dps"], ["tank", "healer"]], count: 4 },
      }),
      lineLinkEvent({
        id: "confuse-statue",
        name: "Confuse Statue",
        link: "sleep-statue",
        target: { roleGroups: [["dps"], ["tank", "healer"]], count: 4 },
      }),
    ],
  });
  const dps = new Set(["r1", "r2", "m1", "m2"]);
  const supports = new Set(["mt", "ot", "h1", "h2"]);
  const seenSleepGroups = new Set<string>();

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const world = runTicks(createWorld(raid, seed), { [HUMAN]: { move: { x: 0, z: 0 } } }, 20);
    const sleep = world.lineLinks.find(link => link.id === "sleep-statue")!;
    const confuse = world.lineLinks.find(link => link.id === "confuse-statue")!;
    const sleepTargetsDps = sleep.targetPlayerIds.every(id => dps.has(id));
    const sleepTargetsSupports = sleep.targetPlayerIds.every(id => supports.has(id));
    expect(sleepTargetsDps || sleepTargetsSupports).toBe(true);
    expect(confuse.targetPlayerIds.every(id => sleepTargetsDps ? supports.has(id) : dps.has(id))).toBe(true);
    seenSleepGroups.add(sleepTargetsDps ? "dps" : "support");
  }

  expect(seenSleepGroups.size).toBe(2);
});

test("line_link resolves applyEffect and knockback once, then removes the hidden debuff", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 10] } }),
    events: [lineLinkEvent({
      target: { playerIds: [HUMAN] },
      applyEffect: { name: "Resolved Link", kind: "debuff", duration: 5, behavior: { kind: "none" } },
      knockback: { distance: 6 },
    })],
  });

  const world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 80);
  const p = human(world);
  expect(p.effects.some(e => e.name === "Line Linked")).toBe(false);
  expect(p.effects.some(e => e.name === "Resolved Link")).toBe(true);
  expect(p.pos.z).toBeLessThan(8);
  expect(world.log.filter(e => e.mechanic === "North Statue" && e.playerId === HUMAN && e.event === "hit")).toHaveLength(1);
});

test("anti-knockback negates line_link knockback", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 10] } }),
    events: [lineLinkEvent({
      target: { playerIds: [HUMAN] },
      knockback: { distance: 6 },
    })],
  });

  let world = tick(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 }, antiKnockback: true } }, 1 / 60);
  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, 80);
  expect(human(world).pos.z).toBeCloseTo(10);
});

test("line_link keeps the world running until it resolves", () => {
  const raid = loadRaid({
    ...baseRaid,
    duration: 0.2,
    players: roster({ m1: { spawn: [0, 10] } }),
    events: [lineLinkEvent({ target: { playerIds: [HUMAN] }, resolveAfter: 1 })],
  });

  let world = runTicks(createWorld(raid), { [HUMAN]: { move: { x: 0, z: 0 } } }, 30);
  expect(world.status).toBe("running");
  world = runTicks(world, { [HUMAN]: { move: { x: 0, z: 0 } } }, 60);
  expect(world.status).toBe("cleared");
});

test("line_link rejects unknown explicit player ids", () => {
  expect(() => loadRaid({
    ...baseRaid,
    events: [lineLinkEvent({ target: { playerIds: ["missing"] } })],
  })).toThrow(/unknown player id/);
});

