import { expect, test } from "bun:test";
import { baseRaid, loadRaid, roster } from "./helpers";

// Guard rail: every debuff used in raid YAML must resolve to a DEBUFF_REGISTRY entry. These tests
// lock in the raidSchema.ts enforcement (ApplyEffectSchema, tether_source, chain, line_link) so a
// future change can't silently reopen the inline/unregistered-debuff path. Buffs are intentionally
// exempt — see raidSchema.ts's ApplyEffectSchema.

function raid(events: unknown[]) {
  return { ...baseRaid, players: roster(), events };
}

test("inline applyEffect debuff is rejected", () => {
  expect(() => loadRaid(raid([{
    type: "apply_effect", id: "e", t: 0, name: "Test", players: ["m1"],
    applyEffect: { name: "Ad Hoc", kind: "debuff", duration: 1, behavior: { kind: "none" } },
  }]))).toThrow(/inline debuffs are not allowed/);
});

test("applyEffect ref to an unknown key is rejected", () => {
  expect(() => loadRaid(raid([{
    type: "apply_effect", id: "e", t: 0, name: "Test", players: ["m1"],
    applyEffect: { ref: "not_a_real_key" },
  }]))).toThrow(/unknown status ref/);
});

test("applyEffect ref coerced to debuff but sourced from BUFF_REGISTRY is rejected", () => {
  expect(() => loadRaid(raid([{
    type: "apply_effect", id: "e", t: 0, name: "Test", players: ["m1"],
    applyEffect: { ref: "tank_limit_break", kind: "debuff" },
  }]))).toThrow(/must be defined in DEBUFF_REGISTRY/);
});

test("applyEffect ref to a registered debuff parses", () => {
  expect(() => loadRaid(raid([{
    type: "apply_effect", id: "e", t: 0, name: "Test", players: ["m1"],
    applyEffect: { ref: "magic_vulnerability" },
  }]))).not.toThrow();
});

test("inline applyEffect buff is still allowed (buffs are out of scope)", () => {
  expect(() => loadRaid(raid([{
    type: "apply_effect", id: "e", t: 0, name: "Test", players: ["m1"],
    applyEffect: { name: "Ad Hoc Buff", kind: "buff", duration: 1, behavior: { kind: "none" } },
  }]))).not.toThrow();
});

test("chain event with an unknown debuff ref is rejected", () => {
  expect(() => loadRaid(raid([{
    type: "chain", id: "c", t: 0, name: "Chain", pairs: [["m1", "ot"]],
    telegraph: 0.5, breakWindow: 5, breakDistance: 12, breakDamage: 40, damageType: "magical",
    debuff: "not_a_real_key",
  }]))).toThrow(/unknown debuff ref/);
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
  }]))).toThrow(/unknown debuff ref/);
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
