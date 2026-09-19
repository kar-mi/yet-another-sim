import { expect, test } from "bun:test";
import {
  applyDamageModifiers,
  applyStatus,
  cleanseAtFullHp,
  consumeStacks,
  isKnockbackImmune,
  modifyKnockback,
  movementControl,
  movementSpeedMultiplier,
  notifyMechanicHit,
  refreshStatus,
  remainingTime,
  removeStatus,
  requireStatus,
  resolveForcedWalk,
  sortForDisplay,
  surviveLethal,
  tickStatuses,
  urgentSlot,
  type StatusActor,
  type StatusServices,
} from "@status";

function actor(id: string, overrides: Partial<StatusActor> = {}): StatusActor {
  return { id, pos: { x: 0, z: 0 }, facing: 0, alive: true, hp: 100, maxHp: 100, invincible: false, effects: [], ...overrides };
}

function harness(actors: StatusActor[], time = 1, previousTime = time - 1 / 60) {
  const calls = {
    damage: [] as Array<{ target: string; amount: number; source: string }>,
    log: [] as Array<{ mechanic: string; actorId: string; event: string }>,
    hits: [] as Array<{ damage: number; source: string }>,
    stacks: [] as Array<{ damage: number; source: string }>,
    applied: [] as string[],
  };
  const services: StatusServices = {
    time,
    previousTime,
    actors,
    damage(target, amount, _damageType, source) {
      calls.damage.push({ target: target.id, amount, source: source.key });
      target.hp = Math.max(0, target.hp - amount);
      if (target.hp <= 0) target.alive = false;
    },
    log(mechanic, actorId, event) { calls.log.push({ mechanic, actorId, event }); },
    recordDeath() {},
    randFloat: () => 0.25,
    hitShape(_shape, damage, _damageType, source) { calls.hits.push({ damage, source: source.name }); },
    resolveStack(_shape, stack, _damageType, source) { calls.stacks.push({ damage: stack.damage, source: source.name }); return true; },
    selectTargets: () => [],
    showAoe() {},
    isLookingAt: () => false,
    launch: () => 0.5,
    scheduleFollowUp() {},
    scheduleTwister() {},
    placeTrap() {},
  };
  return { services, calls };
}

test("applying a grouped status replaces the active member of that group", () => {
  const player = actor("p");
  const { services } = harness([player]);
  applyStatus(player, requireStatus("white_wound"), "w1", services);
  applyStatus(player, requireStatus("black_wound"), "w2", services);
  expect(player.effects.map(status => status.name)).toEqual(["Black Wound"]);
  expect(player.effects[0]).toMatchObject({ ref: "black_wound", id: "w2", appliedAt: 1 });
});

test("refresh and stack consumption replace instances instead of mutating snapshots", () => {
  const player = actor("p");
  const { services } = harness([player], 0);
  applyStatus(player, requireStatus("spells_trouble"), "s", services);
  const snapshot = player.effects;
  const original = snapshot[0]!;
  expect(refreshStatus(player, "s", 5)).toBe(true);
  expect(refreshStatus(player, "missing", 5)).toBe(false);
  consumeStacks(player, "Spells' Trouble", 1, 5);
  expect(player.effects[0]).toMatchObject({ appliedAt: 5, stacks: 3 });
  expect(snapshot).toEqual([original]);
  expect(original).toMatchObject({ appliedAt: 0, stacks: 4 });
  consumeStacks(player, "Spells' Trouble", 3, 5);
  expect(player.effects).toEqual([]);
});

test("escalation swaps stages and punishes at the terminal stage", () => {
  const player = actor("p", { hp: 10 });
  const { services, calls } = harness([player]);
  applyStatus(player, requireStatus("unbecoming"), "u", services);
  applyStatus(player, requireStatus("unbecoming"), "u", services);
  expect(player.effects.map(status => status.ref)).toEqual(["mean"]);
  applyStatus(player, requireStatus("unbecoming"), "u", services);
  expect(calls.damage).toEqual([{ target: "p", amount: 999999, source: "u" }]);
  expect(player.effects.map(status => status.ref)).toEqual(["mean"]);
});

test("alternation swaps colours freely and punishes repeats with the linked status", () => {
  const player = actor("p");
  const { services, calls } = harness([player]);
  applyStatus(player, requireStatus("growing_dread"), "a", services);
  applyStatus(player, requireStatus("growing_panic"), "b", services);
  expect(calls.damage).toEqual([]);
  expect(player.effects.map(status => status.ref)).toEqual(["growing_panic"]);
  applyStatus(player, requireStatus("growing_panic"), "c", services);
  expect(calls.damage).toEqual([{ target: "p", amount: 20, source: "b" }]);
  expect(player.effects.map(status => status.ref)).toEqual(["growing_panic", "thrice_come_ruin"]);
});

test("element cleansing removes one stack per new element and applies its mapped status", () => {
  const player = actor("p");
  const { services } = harness([player]);
  applyStatus(player, requireStatus("elementary_deficiency"), "ed", services);
  const before = player.effects[0]!;
  notifyMechanicHit(player, "Fire IV", services);
  notifyMechanicHit(player, "Fire IV", services);
  expect(player.effects.map(status => [status.ref, status.stacks])).toEqual([
    ["elementary_deficiency", 2],
    ["fire_resistance_down_ii", undefined],
  ]);
  expect(player.effects[1]!.id).toBe("ed-fire_resistance_down_ii");
  expect(before.stacks).toBe(3);
  notifyMechanicHit(player, "Blizzard IV", services);
  notifyMechanicHit(player, "Thunder IV", services);
  expect(player.effects.some(status => status.ref === "elementary_deficiency")).toBe(false);
});

test("survive-lethal and cleanse-at-full-HP rules come from the expiry-damage behavior", () => {
  const player = actor("p", { hp: 50 });
  const { services } = harness([player]);
  applyStatus(player, requireStatus("primordial_crust"), "crust", services);
  applyStatus(player, requireStatus("accretion"), "accretion", services);
  cleanseAtFullHp(player, 1);
  expect(player.effects.map(status => status.ref)).toEqual(["primordial_crust", "accretion"]);
  expect(surviveLethal(player, 1)).toBe(true);
  expect(surviveLethal(player, 1)).toBe(false);
  player.hp = player.maxHp;
  cleanseAtFullHp(player, 1);
  expect(player.effects).toEqual([]);
});

test("expiry fires once inside its tick window and expired statuses are culled", () => {
  const player = actor("p");
  const early = harness([player], 0.5, 0.5 - 1 / 60);
  applyStatus(player, requireStatus("first_in_line", { duration: 1 }), "line", early.services);
  const beforeExpiry = harness([player], 1.5 - 1 / 60, 1.5 - 2 / 60);
  tickStatuses(beforeExpiry.services, () => false);
  expect(beforeExpiry.calls.damage).toEqual([]);
  const atExpiry = harness([player], 1.5, 1.5 - 1 / 60);
  tickStatuses(atExpiry.services, () => false);
  expect(atExpiry.calls.damage).toEqual([{ target: "p", amount: 20, source: "line" }]);
  expect(player.effects).toEqual([]);
});

test("removing a status never runs its expiry behavior", () => {
  const player = actor("p");
  const { services, calls } = harness([player], 1, 1 - 1 / 60);
  applyStatus(player, requireStatus("first_in_line", { duration: 1 / 120 }), "line", harness([player], 1 - 1 / 60).services);
  removeStatus(player, "line");
  tickStatuses(services, () => false);
  expect(calls.damage).toEqual([]);
});

test("simultaneous paired carriers resolve their shared key once", () => {
  const players = ["a", "b", "c", "d"].map(id => actor(id));
  const apply = harness(players, 0);
  applyStatus(players[0]!, requireStatus("compressed_water", { duration: 1 }), "w1", apply.services);
  applyStatus(players[1]!, requireStatus("compressed_water", { duration: 1 }), "w2", apply.services);
  applyStatus(players[2]!, requireStatus("forked_lightning", { duration: 1 }), "l1", apply.services);
  applyStatus(players[3]!, requireStatus("forked_lightning", { duration: 1 }), "l2", apply.services);
  const { services, calls } = harness(players, 1, 1 - 1 / 60);
  tickStatuses(services, () => false);
  expect(calls.hits).toEqual([{ damage: 20, source: "Compressed Water" }, { damage: 20, source: "Compressed Water" }]);
  expect(calls.stacks).toEqual([{ damage: 60, source: "Compressed Water" }, { damage: 60, source: "Compressed Water" }]);
});

test("damage modifiers multiply hits and consume vulnerabilities only on real damage", () => {
  const player = actor("p");
  const { services } = harness([player]);
  applyStatus(player, requireStatus("magic_vulnerability"), "vuln", services);
  applyStatus(player, requireStatus("tank_limit_break"), "lb", services);
  expect(applyDamageModifiers(player, 0, "magical", "Hit", 1)).toBe(0);
  expect(player.effects).toHaveLength(2);
  expect(applyDamageModifiers(player, 100, "magical", "Hit", 1)).toBeCloseTo(15);
  expect(player.effects.map(status => status.ref)).toEqual(["tank_limit_break"]);
});

test("knockback immunity and directional modifiers are status queries", () => {
  const player = actor("p");
  const { services } = harness([player]);
  expect(isKnockbackImmune(player, 1)).toBe(false);
  applyStatus(player, requireStatus("arms_length"), "al", services);
  expect(isKnockbackImmune(player, 1)).toBe(true);
  expect(isKnockbackImmune(player, 6)).toBe(false);
  applyStatus(player, requireStatus("tailwind"), "tw", services);
  expect(modifyKnockback(player, { distance: 5, height: 0 }, { x: 0, z: -1 }, 1)).toEqual({ distance: 10, height: 0 });
  expect(player.effects.map(status => status.ref)).toEqual(["arms_length"]);
});

test("sprint speed and remaining time follow the catalog duration", () => {
  const player = actor("p");
  const { services } = harness([player], 2);
  applyStatus(player, requireStatus("sprint"), "sprint", services);
  applyStatus(player, requireStatus("sprint"), "sprint", harness([player], 4).services);
  expect(player.effects).toHaveLength(1);
  expect(remainingTime(player, "sprint", 4)).toBe(10);
  expect(movementSpeedMultiplier(player, 13.99)).toBe(1.3);
  expect(movementSpeedMultiplier(player, 14)).toBe(1);
});

test("sleep freezes input and confusion forces a walk that ends on contact", () => {
  const confused = actor("c");
  const target = actor("t", { pos: { x: 5, z: 0 } });
  const { services, calls } = harness([confused, target]);
  applyStatus(confused, requireStatus("confusion"), "conf", services);
  const control = movementControl(confused, 1);
  expect(control.frozen).toBe(false);
  expect(control.forcedWalk?.lockedTargetId).toBe("t");
  expect(resolveForcedWalk(confused, control.forcedWalk!, services)).toEqual({ x: 5, z: 0 });
  confused.pos = { x: 4, z: 0 };
  expect(resolveForcedWalk(confused, control.forcedWalk!, services)).toBeUndefined();
  expect(calls.damage).toEqual([{ target: "t", amount: 50, source: "conf" }]);
  expect(confused.effects).toEqual([]);
  applyStatus(confused, requireStatus("sleep"), "sleep", services);
  expect(movementControl(confused, 1)).toEqual({ frozen: true });
});

test("display order puts priority first and slotted statuses in slot order", () => {
  const player = actor("p");
  const { services } = harness([player], 0);
  applyStatus(player, requireStatus("plant_long"), "long", services, { plantSlot: 1 });
  applyStatus(player, requireStatus("plant_short"), "short", services, { plantSlot: 0 });
  applyStatus(player, requireStatus("debug_priority_hud_effect"), "priority", services);
  expect(sortForDisplay(player.effects, () => true).map(status => status.id)).toEqual(["priority", "short", "long"]);
  expect(urgentSlot(player)).toBe(0);
});
