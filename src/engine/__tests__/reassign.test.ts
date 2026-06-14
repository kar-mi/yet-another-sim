import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { baseRaid, byId, loadRaid, noMove, roster, runTicks, withPlayerEffect } from "./helpers";
import type { StatusEffect } from "@shared/types";

const stackCharge = {
  kind: "stack",
  effect: { name: "Stack Charge", kind: "debuff", duration: 100, visibility: "invisible", behavior: { kind: "none" } },
  marker: { name: "Stack Charge Marker", kind: "debuff", duration: 5, visibility: "invisible", markerIcon: "stack_processed.png", behavior: { kind: "none" } },
};

const seededStack: StatusEffect = {
  id: "seed", name: "Stack Charge", kind: "debuff", appliedAt: 0, duration: 100,
  behavior: { kind: "none" }, visibility: "invisible",
};

// A minimal one-tower wave: two players soak a tower whose resolver consumes the Stack Charge, then
// the reassign re-balances back up to the trigger label's target counts onto the just-resolved soakers.
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
  world = withPlayerEffect(world, "mt", seededStack); // the soaker the tower will consume

  world = runTicks(world, noMove, 20);
  const stacks = byId(world, "mt").effects.filter(e => e.name === "Stack Charge");
  // The seeded charge was consumed at the tower, then a fresh one re-dealt to the soaker.
  expect(stacks).toHaveLength(1);
  expect(stacks[0]!.id).not.toBe("seed");
});

test("a resolved tower whose label is not in onResolve does not re-deal", () => {
  let world = createWorld(waveRaid({ "tower-even": { stack: 1 } }), 1);
  world = withPlayerEffect(world, "mt", seededStack);

  world = runTicks(world, noMove, 20);
  // The charge is consumed by the resolver, and nothing re-deals it (label mismatch).
  expect(byId(world, "mt").effects.some(e => e.name === "Stack Charge")).toBe(false);
});
