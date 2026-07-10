import { expect, test } from "bun:test";
import { createWorld } from "../world";
import { loadRaid, roster, runTicks } from "./helpers";

const run = (events: unknown[], players = {}) => runTicks(createWorld(loadRaid({
  name: "P4 primitive", arena: { zones: [{ kind: "circle", center: [0, 0], radius: 30 }] }, duration: 2,
  players: roster(players), events,
})), {}, 20);

test("carrier spread_stack swaps its two carrier roles", () => {
  const effects = ["Compressed Water", "Compressed Water", "Forked Lightning", "Forked Lightning"];
  const players = { mt: { spawn: [-10, 0] as [number, number] }, ot: { spawn: [10, 0] as [number, number] }, h1: { spawn: [-18, 0] as [number, number] }, h2: { spawn: [18, 0] as [number, number] }, m1: { spawn: [-10, 1] as [number, number] }, m2: { spawn: [10, 1] as [number, number] }, r1: { spawn: [-9, 0] as [number, number] }, r2: { spawn: [9, 0] as [number, number] } };
  const events: unknown[] = effects.map((name, i) => ({ type: "apply_effect", id: `mark-${i}`, t: 0, name, players: [["mt", "ot", "h1", "h2"][i]], applyEffect: { name, kind: "debuff", duration: 2, behavior: { kind: "none" } } }));
  events.push({ type: "spread_stack", id: "death-wave", t: 0.1, name: "Death Wave", telegraph: 0.1, shown: "spread", damageType: "true", stackCarriers: "Compressed Water", spreadCarriers: "Forked Lightning", spread: { radius: 1, damage: 10 }, stack: { groups: [["mt"]], radius: 2, requiredCount: 3, damage: 60 } });
  const world = run(events, players);
  expect(world.log.filter(entry => entry.mechanic === "Death Wave" && entry.event === "hit")).toHaveLength(8);
  expect(world.players.filter(player => ["mt", "ot", "m1", "m2", "r1", "r2"].includes(player.id)).every(player => player.hp === player.maxHp - 20)).toBe(true);
  expect(world.players.filter(player => ["h1", "h2"].includes(player.id)).every(player => player.hp === player.maxHp - 10)).toBe(true);
});

test("carrier gaze excludes its own eyes and reverse requires facing both", () => {
  const world = run([
    { type: "apply_effect", id: "mark-mt", t: 0, name: "Shriek", players: ["mt", "ot"], applyEffect: { name: "Shriek", kind: "debuff", duration: 2, behavior: { kind: "none" } } },
    { type: "gaze", id: "shriek", t: 0.1, name: "Shriek", telegraph: 0.1, carriers: "Shriek", reverse: true, damage: 999, damageType: "true" },
  ], { mt: { spawn: [-2, 0] }, ot: { spawn: [2, 0] }, h1: { spawn: [0, 0] } });
  expect(world.players.find(player => player.id === "mt")!.alive).toBe(true);
  expect(world.players.find(player => player.id === "ot")!.alive).toBe(true);
  expect(world.players.find(player => player.id === "h1")!.alive).toBe(true);
});

test("effect_burst chooses the hidden donut when inverted", () => {
  const world = run([
    { type: "apply_effect", id: "mark", t: 0, name: "Entropy", players: ["m1"], applyEffect: { name: "Entropy", kind: "debuff", duration: 2, behavior: { kind: "none" } } },
    { type: "effect_burst", id: "burst", t: 0.1, name: "Burst", telegraph: 0.1, effectName: "Entropy", radius: 5, innerRadius: 2, shownShape: "circle", hiddenShape: "donut", questionMark: true, damage: 20, damageType: "true" },
  ], { m1: { spawn: [0, 0] }, m2: { spawn: [3, 0] } });
  expect(world.players.find(player => player.id === "m1")!.hp).toBe(100);
  expect(world.players.find(player => player.id === "m2")!.hp).toBe(80);
});

test("effect groups replace the wound and effect_check kills mismatches", () => {
  const world = run([
    { type: "apply_effect", id: "origin", t: 0, name: "White Wound", players: ["m1"], applyEffect: { name: "White Wound", kind: "debuff", duration: 2, group: "origin", behavior: { kind: "none" } } },
    { type: "apply_effect", id: "wound", t: 0, name: "Black Wound", players: ["m1"], applyEffect: { name: "Black Wound", kind: "debuff", duration: 2, group: "wound", behavior: { kind: "none" } } },
    { type: "apply_effect", id: "field", t: 0, name: "Allagan Field", players: ["m1"], applyEffect: { name: "Allagan Field", kind: "debuff", duration: 2, behavior: { kind: "none" } } },
    { type: "effect_check", id: "check", t: 0.1, name: "Death Surge", checks: [{ carriers: "Allagan Field", compare: ["wound", "origin"], expect: "differs" }], failureDamage: 999, failureDamageType: "true" },
  ]);
  expect(world.players.find(player => player.id === "m1")!.alive).toBe(true);
  const failed = run([
    { type: "apply_effect", id: "origin", t: 0, name: "White Wound", players: ["m1"], applyEffect: { name: "White Wound", kind: "debuff", duration: 2, group: "origin", behavior: { kind: "none" } } },
    { type: "apply_effect", id: "wound", t: 0, name: "White Wound", players: ["m1"], applyEffect: { name: "White Wound", kind: "debuff", duration: 2, group: "wound", behavior: { kind: "none" } } },
    { type: "apply_effect", id: "field", t: 0, name: "Allagan Field", players: ["m1"], applyEffect: { name: "Allagan Field", kind: "debuff", duration: 2, behavior: { kind: "none" } } },
    { type: "effect_check", id: "check", t: 0.1, name: "Death Surge", checks: [{ carriers: "Allagan Field", compare: ["wound", "origin"], expect: "differs" }], failureDamage: 999, failureDamageType: "true" },
  ]);
  expect(failed.players.find(player => player.id === "m1")!.alive).toBe(false);
});
