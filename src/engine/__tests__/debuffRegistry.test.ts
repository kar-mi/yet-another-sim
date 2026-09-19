import { expect, test } from "bun:test";
import { baseRaid, loadRaid, roster } from "./helpers";

// Guard rail: every buff and debuff used in raid YAML must resolve to a status catalog template
// (applyEffect, tether_source, chain, line_link), so the inline/unregistered path stays closed.

function raid(events: unknown[]) {
  return { ...baseRaid, players: roster(), events };
}

test("inline applyEffect debuff is rejected", () => {
  expect(() => loadRaid(raid([{
    type: "apply_effect", id: "e", t: 0, name: "Test", players: ["m1"],
    applyEffect: { name: "Ad Hoc", kind: "debuff", duration: 1, behavior: { kind: "none" } },
  }]))).toThrow(/reference a catalog template/);
});

test("applyEffect ref to an unknown key is rejected", () => {
  expect(() => loadRaid(raid([{
    type: "apply_effect", id: "e", t: 0, name: "Test", players: ["m1"],
    applyEffect: { ref: "not_a_real_key" },
  }]))).toThrow(/unknown status ref/);
});

test("applyEffect ref cannot reclassify a buff as a debuff", () => {
  expect(() => loadRaid(raid([{
    type: "apply_effect", id: "e", t: 0, name: "Test", players: ["m1"],
    applyEffect: { ref: "tank_limit_break", kind: "debuff" },
  }]))).toThrow(/classification cannot be overridden/);
});

test("applyEffect ref cannot change its behavior kind", () => {
  expect(() => loadRaid(raid([{
    type: "apply_effect", id: "e", t: 0, name: "Test", players: ["m1"],
    applyEffect: { ref: "magic_vulnerability", behavior: { kind: "none" } },
  }]))).toThrow(/it cannot be overridden to/);
});

test("applyEffect ref to a registered debuff parses", () => {
  expect(() => loadRaid(raid([{
    type: "apply_effect", id: "e", t: 0, name: "Test", players: ["m1"],
    applyEffect: { ref: "magic_vulnerability" },
  }]))).not.toThrow();
});

test("inline applyEffect buff is rejected", () => {
  expect(() => loadRaid(raid([{
    type: "apply_effect", id: "e", t: 0, name: "Test", players: ["m1"],
    applyEffect: { name: "Ad Hoc Buff", kind: "buff", duration: 1, behavior: { kind: "none" } },
  }]))).toThrow(/reference a catalog template/);
});

test("chain event with an unknown debuff ref is rejected", () => {
  expect(() => loadRaid(raid([{
    type: "chain", id: "c", t: 0, name: "Chain", pairs: [["m1", "ot"]],
    telegraph: 0.5, breakWindow: 5, breakDistance: 12, breakDamage: 40, damageType: "magical",
    debuff: "not_a_real_key",
  }]))).toThrow(/unknown status ref/);
});

test("chain event with a registered debuff parses", () => {
  expect(() => loadRaid(raid([{
    type: "chain", id: "c", t: 0, name: "Chain", pairs: [["m1", "ot"]],
    telegraph: 0.5, breakWindow: 5, breakDistance: 12, breakDamage: 40, damageType: "magical",
    debuff: "chain_bond",
  }]))).not.toThrow();
});

test("line_link event with an unknown hiddenDebuff ref is rejected", () => {
  expect(() => loadRaid(raid([{
    type: "line_link", id: "l", t: 0, name: "Statue", pos: [0, 0],
    resolveAfter: 1, target: { mode: "closest" }, hiddenDebuff: "not_a_real_key",
  }]))).toThrow(/unknown status ref/);
});

test("chain event rejects a buff as its debuff", () => {
  expect(() => loadRaid(raid([{
    type: "chain", id: "c", t: 0, name: "Chain", pairs: [["m1", "ot"]],
    telegraph: 0.5, breakWindow: 5, breakDistance: 12, breakDamage: 40, damageType: "magical",
    debuff: "tank_limit_break",
  }]))).toThrow(/must be a debuff/);
});

test("line_link event with a registered hiddenDebuff parses", () => {
  expect(() => loadRaid(raid([{
    type: "line_link", id: "l", t: 0, name: "Statue", pos: [0, 0],
    resolveAfter: 1, target: { mode: "closest" }, hiddenDebuff: "line_linked",
  }]))).not.toThrow();
});

test("tether_source applyEffect kind must match tetherKind", () => {
  expect(() => loadRaid(raid([{
    type: "tether_source", id: "t", t: 0, name: "Tether", pos: [0, 0], finalizeAfter: 1,
    tetherKind: "debuff", buffName: "Mismatch", applyEffect: { ref: "tank_limit_break" },
  }]))).toThrow(/must match tetherKind/);
});

test("tether_source with a registered debuff applyEffect parses", () => {
  expect(() => loadRaid(raid([{
    type: "tether_source", id: "t", t: 0, name: "Tether", pos: [0, 0], finalizeAfter: 1,
    tetherKind: "debuff", buffName: "Doom", applyEffect: { ref: "debug_doom" },
  }]))).not.toThrow();
});
