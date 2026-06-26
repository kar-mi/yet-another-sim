import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { baseRaid, byId, loadRaid, noMove, runTicks } from "./helpers";

const supportIds = ["mt", "ot", "h1", "h2"];
const dpsIds = ["r1", "r2", "m1", "m2"];

function hasEffect(world: ReturnType<typeof createWorld>, playerId: string, effectName: string) {
return byId(world, playerId).effects.some(effect => effect.name === effectName);
}

function holders(world: ReturnType<typeof createWorld>, ids: string[], effectName: string) {
return ids.filter(id => hasEffect(world, id, effectName));
}

const raid = loadRaid({
...baseRaid,
events: [
{
type: "apply_effect",
t: 0,
id: "entropy-support",
name: "Entropy",
players: supportIds,
count: 1,
rng: true,
assignGroup: "ef-debuffs",
applyEffect: { name: "Entropy", kind: "debuff", duration: 18, behavior: { kind: "none" } },
},
{
type: "apply_effect",
t: 0,
id: "entropy-dps",
name: "Entropy",
players: dpsIds,
count: 1,
rng: true,
assignGroup: "ef-debuffs",
applyEffect: { name: "Entropy", kind: "debuff", duration: 18, behavior: { kind: "none" } },
},
{
type: "apply_effect",
t: 0,
id: "dynamic-fluid-support",
name: "Dynamic Fluid",
players: supportIds,
count: 1,
rng: true,
assignGroup: "ef-debuffs",
applyEffect: { name: "Dynamic Fluid", kind: "debuff", duration: 45, behavior: { kind: "none" } },
},
{
type: "apply_effect",
t: 0,
id: "dynamic-fluid-dps",
name: "Dynamic Fluid",
players: dpsIds,
count: 1,
rng: true,
assignGroup: "ef-debuffs",
applyEffect: { name: "Dynamic Fluid", kind: "debuff", duration: 45, behavior: { kind: "none" } },
},
],
});

test("apply_effect assignGroup excludes earlier selected targets in the same tick", () => {
const entropySupports = new Set<string>();
const entropyDps = new Set<string>();

for (let seed = 0; seed < 50; seed++) {
const world = runTicks(createWorld(raid, seed), noMove, 2);

const entropySupport = holders(world, supportIds, "Entropy");
const entropyDamage = holders(world, dpsIds, "Entropy");
const fluidSupport = holders(world, supportIds, "Dynamic Fluid");
const fluidDamage = holders(world, dpsIds, "Dynamic Fluid");

expect(entropySupport).toHaveLength(1);
expect(entropyDamage).toHaveLength(1);
expect(fluidSupport).toHaveLength(1);
expect(fluidDamage).toHaveLength(1);

expect(entropySupport[0]).not.toBe(fluidSupport[0]);
expect(entropyDamage[0]).not.toBe(fluidDamage[0]);
for (const playerId of [...supportIds, ...dpsIds]) {
expect(hasEffect(world, playerId, "Entropy") && hasEffect(world, playerId, "Dynamic Fluid")).toBe(false);
}

entropySupports.add(entropySupport[0]!);
entropyDps.add(entropyDamage[0]!);
}

expect(entropySupports.size).toBeGreaterThan(1);
expect(entropyDps.size).toBeGreaterThan(1);
});
