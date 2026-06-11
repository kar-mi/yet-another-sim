import { expect, test } from "bun:test";
import { computeBotIntents } from "../botIntent";
import { tick } from "../sim";
import { createWorld } from "../world";
import { HUMAN, baseRaid, effect, human, loadRaid, roster, runTicks, runTicksWithBotIntents, withEffect } from "./helpers";

test("confusion: walks toward the locked target (not the nearest) and hits only the target", () => {
  const raid = loadRaid({
    ...baseRaid,
    players: roster({ m1: { spawn: [0, 0] }, m2: { spawn: [0, 10] }, r1: { spawn: [3, 0] } }),
  });
  const confused = withEffect(createWorld(raid), effect({
    name: "Confusion",
    behavior: { kind: "confusion", damage: 50, damageType: "true", radius: 1.5 },
    lockedTargetId: "m2",
  }));
  const idle = { [HUMAN]: { move: { x: 0, z: 0 } } };

  // Moves toward the locked m2 (+z), ignoring the much closer r1 (+x).
  const moving = runTicks(confused, idle, 10);
  expect(human(moving).pos.z).toBeGreaterThan(0);
  expect(human(moving).pos.x).toBeCloseTo(0);

  // Reaching m2 (~10 units at 6/s) deals friendly fire to the target only, then ends the debuff.
  const reached = runTicks(confused, idle, 120);
  const m2 = reached.players.find(p => p.id === "m2")!;
  expect(m2.hp).toBe(m2.maxHp - 50);
  expect(human(reached).hp).toBe(human(reached).maxHp);
  expect(human(reached).effects.some(e => e.behavior.kind === "confusion")).toBe(false);
});

test("sleep: disables input for its duration (not broken by time), then movement resumes", () => {
  const raid = loadRaid({ ...baseRaid, players: roster({ m1: { spawn: [0, 0] } }) });
  const asleep = withEffect(createWorld(raid), effect({
    name: "Sleep", duration: 1, behavior: { kind: "sleep" },
  }));
  const move = { [HUMAN]: { move: { x: 1, z: 0 } } };

  // While asleep (1s) the move intent is ignored and the debuff persists.
  const during = runTicks(asleep, move, 30);
  expect(human(during).pos.x).toBeCloseTo(0);
  expect(human(during).effects.some(e => e.behavior.kind === "sleep")).toBe(true);

  // Once it expires, the same intent moves the player again.
  const after = runTicks(asleep, move, 90);
  expect(human(after).pos.x).toBeGreaterThan(0);
});

test("forced march: freezes the entrant, teleports after the pre-delay, then releases", () => {
  const raid = loadRaid({
    ...baseRaid,
    duration: 5,
    players: roster({ m1: { spawn: [5, 0] } }),
    events: [{ type: "forced_march", t: 0, name: "March", pos: [5, 0], radius: 2, direction: [1, 0], distance: 8, duration: 3, preDelay: 0.3, postDelay: 0.3 }],
  });
  const pushW = { [HUMAN]: { move: { x: -1, z: 0 } } }; // try to walk away while captured

  // Stepped on (tick 1): captured + frozen, not yet teleported.
  const captured = runTicks(createWorld(raid), pushW, 1);
  expect(captured.forcedMarches[0]!.triggered).toBe(true);
  expect(captured.forcedMarches[0]!.teleported).toBe(false);

  // During the pre-delay the held player cannot move despite the input (frozen where captured).
  const winding = runTicks(createWorld(raid), pushW, 15); // ~0.25s < 0.3 pre-delay
  expect(winding.forcedMarches[0]!.teleported).toBe(false);
  expect(human(winding).pos.x).toBeCloseTo(human(captured).pos.x);

  // After the pre-delay the teleport fires along +x.
  const flung = runTicks(createWorld(raid), pushW, 25); // ~0.42s > 0.3 pre-delay
  expect(flung.forcedMarches[0]!.teleported).toBe(true);
  expect(human(flung).pos.x).toBeCloseTo(13); // 5 + 8 along +x
  expect(human(flung).pos.z).toBeCloseTo(0);

  // Once the full freeze window ends the player can move again.
  const freed = runTicks(createWorld(raid), pushW, 60); // 1s > preDelay + postDelay
  expect(human(freed).pos.x).toBeLessThan(13);
});

test("forced march suppresses stale bot waypoints until the next authored waypoint", () => {
  const raid = loadRaid({
    ...baseRaid,
    duration: 5,
    players: roster({
      mt: {
        spawn: [0, 0],
        pattern: [{ t: 0, pos: [0, 0] }, { t: 2, pos: [0, 8] }],
      },
    }),
    events: [{ type: "forced_march", t: 0, name: "March", pos: [0, 0], radius: 2, direction: [1, 0], distance: 8, duration: 3, preDelay: 0.1, postDelay: 0.1 }],
  });

  let world = runTicksWithBotIntents(createWorld(raid), Math.ceil(0.7 * 60));
  expect(world.players.find(p => p.id === "mt")!.pos.x).toBeCloseTo(8);
  expect(computeBotIntents(world, 1 / 60).mt).toBeUndefined();

  world = runTicksWithBotIntents(world, Math.ceil(1.5 * 60));
  expect(computeBotIntents(world, 1 / 60).mt?.move?.z).toBeGreaterThan(0);
});

test("forced march: an untriggered trap expires after its duration", () => {
  const raid = loadRaid({
    ...baseRaid,
    duration: 5,
    players: roster(), // everyone at clock spots (radius 8); nobody sits on the origin trap
    events: [{ type: "forced_march", t: 0, name: "March", pos: [0, 0], radius: 1, direction: [0, 1], distance: 5, duration: 1 }],
  });
  const idle = { [HUMAN]: { move: { x: 0, z: 0 } } };

  const armed = runTicks(createWorld(raid), idle, 30);
  expect(armed.forcedMarches.length).toBe(1);
  expect(armed.forcedMarches[0]!.triggered).toBe(false);

  const expired = runTicks(createWorld(raid), idle, 80);
  expect(expired.forcedMarches.length).toBe(0);
});

test("schema accepts confusion and sleep effect behaviors and the forced_march event", () => {
  expect(() => loadRaid({
    ...baseRaid,
    events: [
      { type: "aoe", t: 1, name: "Confuse", telegraph: 1, damage: 0, damageType: "magical",
        shape: { kind: "circle", center: [0, 0], radius: 5 },
        applyEffect: { name: "Confusion", kind: "debuff", duration: 8, behavior: { kind: "confusion", damage: 80, damageType: "true", radius: 1.5 } } },
      { type: "aoe", t: 2, name: "Sleep", telegraph: 1, damage: 0, damageType: "magical",
        shape: { kind: "circle", center: [0, 0], radius: 5 },
        applyEffect: { name: "Sleep", kind: "debuff", duration: 5, behavior: { kind: "sleep" } } },
      { type: "forced_march", t: 3, name: "March", pos: [0, 0], radius: 3, direction: [0, 1], distance: 10, duration: 4 },
    ],
  })).not.toThrow();
});
