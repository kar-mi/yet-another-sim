import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { DPS_HP, TANK_HP } from "./constants";
import type { Player, World } from "@shared/types";
import { HUMAN, baseRaid, human, loadRaid, roster, runTicks } from "./helpers";
import type { Vec } from "./helpers";

// --- Chains ---------------------------------------------------------------
// A chain bonds two named players; at cast end (t=0.6) both gain "Chain Bond",
// and they have until expiry (t=5.6) to separate past breakDistance or both eat breakDamage.
const chainEvent = {
  type: "chain" as const,
  t: 0.1,
  name: "Test Chain",
  pairs: [["m1", "ot"]] as [string, string][],
  telegraph: 0.5,
  breakWindow: 5,
  breakDistance: 12,
  breakDamage: 40,
  damageType: "magical" as const,
  debuffName: "Chain Bond",
  showCastBar: true,
};

// m1 (the human) and ot start 1 unit apart; arena is roomy so the human can walk far.
const chainRaid = () => loadRaid({
  ...baseRaid,
  arena: { zones: [{ kind: "circle" as const, center: [0, 0] as Vec, radius: 30 }] },
  players: roster({ m1: { spawn: [0, 0] }, ot: { spawn: [1, 0] } }),
  events: [chainEvent],
});

const otPlayer = (world: World) => world.players.find(p => p.id === "ot")!;
const hasChainBond = (p: Player) => p.effects.some(e => e.name === "Chain Bond");

test("chain applies its debuff to both members at cast end", () => {
  const world = runTicks(createWorld(chainRaid()), {}, Math.ceil(0.7 * 60));
  expect(hasChainBond(human(world))).toBe(true);
  expect(hasChainBond(otPlayer(world))).toBe(true);
  expect(human(world).hp).toBe(DPS_HP);
  expect(otPlayer(world).hp).toBe(TANK_HP); // ot is a tank, no damage yet
});

test("separating a chained pair past breakDistance breaks it with no damage", () => {
  // Human walks +x away from the stationary partner until the chain stretches past
  // (starting distance + breakDistance) and snaps; runs well before the expiry burst.
  const world = runTicks(createWorld(chainRaid()), { [HUMAN]: { move: { x: 1, z: 0 } } }, Math.ceil(3.0 * 60));
  expect(hasChainBond(human(world))).toBe(false);
  expect(hasChainBond(otPlayer(world))).toBe(false);
  expect(human(world).hp).toBe(DPS_HP);
  expect(otPlayer(world).hp).toBe(TANK_HP); // ot is a tank, broke with no damage
});

test("a chain left unbroken bursts both members once at expiry", () => {
  // Both stand still through the whole window (expires at 5.6); run past it.
  const world = runTicks(createWorld(chainRaid()), {}, Math.ceil(6.0 * 60));
  expect(human(world).hp).toBe(60); // 100 - 40, applied exactly once
  expect(otPlayer(world).hp).toBe(TANK_HP - 40); // tank, burst applied exactly once
  expect(hasChainBond(human(world))).toBe(false);
  expect(hasChainBond(otPlayer(world))).toBe(false);
});

