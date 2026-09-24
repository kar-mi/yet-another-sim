import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { baseRaid, byId, loadRaid, noMove, roster, runTicks, withPlayerEffect } from "./helpers";
import type { StatusEffect } from "@model/types";

const stackCharge = {
  kind: "stack",
  effect: { ref: "stack_charge", duration: 100 },
  marker: { ref: "stack_charge_marker" },
};

const seededStack: StatusEffect = {
  id: "seed", ref: "stack_charge", name: "Stack Charge", kind: "debuff", appliedAt: 0, duration: 100,
  behavior: { kind: "none" }, visibility: "invisible",
};

function waveRaid(onResolve: Record<string, Record<string, number>>) {
  return loadRaid({
    ...baseRaid,
    duration: 5,
    players: roster({ mt: { spawn: [0, 0] }, ot: { spawn: [0, 0] } }),
    events: [
      { type: "reassign", id: "charges", t: 0, name: "Charges", onResolve, charges: [stackCharge] },
      { type: "effect_resolver", id: "stack-resolve", name: "Stack Resolve", effectName: "Stack Charge",
        action: { kind: "stack", radius: 5, requiredCount: 1, damage: 0, damageType: "magical" } },
      { type: "tower", id: "wave-tower", t: 0.05, name: "Wave Tower", labels: ["tower-odd"],
        telegraph: 0.1, pos: [0, 0], radius: 5, requiredCount: 1,
        failureDamage: 0, failureDamageType: "true", resolveEventIds: ["stack-resolve"] },
    ],
  });
}

test("reassign re-balances charges onto the just-resolved soakers after a labelled tower", () => {
  let world = createWorld(waveRaid({ "tower-odd": { stack: 1 } }), 1);
  world = withPlayerEffect(world, "mt", seededStack);

  world = runTicks(world, noMove, 20);
  const stacks = byId(world, "mt").effects.filter(e => e.name === "Stack Charge");
  expect(stacks).toHaveLength(1);
  expect(stacks[0]!.id).not.toBe("seed");
});

test("a resolved tower whose label is not in onResolve does not re-deal", () => {
  let world = createWorld(waveRaid({ "tower-even": { stack: 1 } }), 1);
  world = withPlayerEffect(world, "mt", seededStack);

  world = runTicks(world, noMove, 20);
  expect(byId(world, "mt").effects.some(e => e.name === "Stack Charge")).toBe(false);
});
