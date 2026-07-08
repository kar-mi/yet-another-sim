import { computeBotIntents } from "../botIntent";
import { loadRaid as loadRaidRaw } from "../raidLoader";
import { tick } from "../sim";
import { createWorld } from "../world";
import { CLOCK_SPOTS, ROSTER } from "@shared/protocol";
import type { Intents, Player, StatusEffect, World } from "@shared/types";

// The slot these tests treat as the human player (a dps) — the target of withEffect and the noMove
// override. Control is no longer authored on raids; use withControl to actually mark it human.
export const HUMAN = "m1";

export type Vec = [number, number];
export type Override = { spawn?: Vec; pattern?: { t: number; pos: Vec }[] };

// Build the canonical roster (mt, ot, h1, h2, r1, r2, m1, m2) at clock spots, with per-id overrides.
// Raids no longer author control; every slot loads as a bot. Use withControl to mark a human slot.
export function roster(over: Record<string, Override> = {}) {
  return ROSTER.map(({ id, role }) => {
    const o = over[id] ?? {};
    return {
      id,
      role,
      spawn: o.spawn ?? (CLOCK_SPOTS[id] as Vec),
      ...(o.pattern ? { pattern: o.pattern } : {}),
    };
  });
}

export const baseRaid = {
  name: "Test",
  arena: { zones: [{ kind: "circle" as const, center: [0, 0] as Vec, radius: 20 }] },
  duration: 10,
  players: roster(),
  events: [] as unknown[],
};

export function loadRaid(json: unknown) {
  if (!json || typeof json !== "object" || !("events" in json) || !Array.isArray(json.events)) {
    return loadRaidRaw(json);
  }
  const raid = json as { events: unknown[] };
  return loadRaidRaw({
    ...raid,
    events: raid.events.map((event, i) => {
      if (!event || typeof event !== "object" || "id" in event) return event;
      const typedEvent = event as { type?: string };
      return { id: `${typedEvent.type ?? "aoe"}-${i}`, ...typedEvent };
    }),
  });
}

export function runTicks(world: ReturnType<typeof createWorld>, intents: Intents, count: number) {
  let w = world;
  for (let i = 0; i < count; i++) w = tick(w, intents, 1 / 60);
  return w;
}

export function runTicksWithBotIntents(world: ReturnType<typeof createWorld>, count: number) {
  let w = world;
  for (let i = 0; i < count; i++) {
    w = tick(w, { ...computeBotIntents(w, 1 / 60), [HUMAN]: { move: { x: 0, z: 0 } } }, 1 / 60);
  }
  return w;
}

export function runTicksWithComputedBotIntents(world: ReturnType<typeof createWorld>, count: number) {
  let w = world;
  for (let i = 0; i < count; i++) {
    w = tick(w, computeBotIntents(w, 1 / 60), 1 / 60);
  }
  return w;
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function withPlayerEffect(world: World, playerId: string, effect: StatusEffect): World {
  return {
    ...world,
    players: world.players.map(player => player.id === playerId
      ? { ...player, effects: [...player.effects, effect] }
      : player),
  };
}

export function withEffect(world: World, effect: StatusEffect): World {
  return withPlayerEffect(world, HUMAN, effect);
}

// Mark a slot as human-controlled at the world level (control is no longer authored on the raid).
export function withControl(world: World, playerId: string, control: "human" | "bot"): World {
  return {
    ...world,
    players: world.players.map(player => player.id === playerId ? { ...player, control } : player),
  };
}

export function effect(overrides: Partial<StatusEffect> = {}): StatusEffect {
  return {
    id: "effect-1",
    name: "Effect",
    kind: "debuff",
    appliedAt: 0,
    duration: 10,
    behavior: { kind: "none" },
    ...overrides,
  };
}

export const human = (world: World) => world.players.find(p => p.id === HUMAN)!;
export const byId = (world: World, id: string) => world.players.find((p: Player) => p.id === id)!;
export const noMove = { [HUMAN]: { move: { x: 0, z: 0 } } };
