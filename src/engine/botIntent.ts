import type { Vec2 } from "../shared/math";
import type { Intents, Player, Waypoint, World } from "../shared/types";
import { length, normalize, sub } from "../shared/math";
import { MOVE_SPEED } from "./sim";

function activeWaypoint(pattern: Waypoint[], time: number, after = -Infinity): Waypoint | undefined {
  let active: Waypoint | undefined;
  for (const waypoint of pattern) {
    if (waypoint.t > after && waypoint.t <= time && (!active || waypoint.t >= active.t)) {
      active = waypoint;
    }
  }
  return active;
}

function directionName(direction: [number, number]): "up" | "down" | "left" | "right" | undefined {
  const [x, z] = direction;
  if (x === 0 && z === 1) return "up";
  if (x === 0 && z === -1) return "down";
  if (x === -1 && z === 0) return "left";
  if (x === 1 && z === 0) return "right";
  return undefined;
}

function activePlantSlot(player: Player): number | undefined {
  let active: Player["effects"][number] | undefined;
  for (const effect of player.effects) {
    if (effect.behavior.kind !== "plant") continue;
    if (!active || effect.appliedAt + effect.duration < active.appliedAt + active.duration) {
      active = effect;
    }
  }
  return active?.plantSlot;
}

function hasActiveDoubleTrouble(player: Player, time: number): boolean {
  return player.effects.some(effect =>
    effect.behavior.kind === "doubleTrouble"
    && effect.appliedAt <= time
    && effect.appliedAt + effect.duration > time);
}

function plantComboKey(player: Player, world: World): string | undefined {
  if (activePlantSlot(player) === undefined) return undefined;

  const combo = world.plantPlan[player.id];
  if (!combo?.length) return undefined;

  const names = combo.map(directionName);
  if (names.some(name => name === undefined)) return undefined;
  return names.join(" ");
}

function solverWaypoint(player: Player, world: World): Vec2 | undefined {
  const slot = activePlantSlot(player);
  if (slot !== undefined) {
    const key = plantComboKey(player, world);
    if (key) {
      const placement = world.botSolvers?.plantArrows?.placements[key];
      if (placement) return Array.isArray(placement) ? placement[slot] : placement;
    }
  }

  // Spread/stack "?": go to the assigned spot for the *actual* mode (bots solve the real answer).
  const spreadStack = world.spreadStacks.find(s => !s.resolved);
  if (spreadStack) {
    const actual = spreadStack.inverted
      ? (spreadStack.shown === "spread" ? "stack" : "spread")
      : spreadStack.shown;
    const cfg = world.botSolvers?.spreadStack;
    // Per-orientation override: when a named inverse ("lightning") is active, swap to the safe-corridor
    // positions for its current orientation; otherwise use the base positions.
    const orient = (base?: Record<string, Vec2>, override?: { id: string; shown: Record<string, Vec2>; inverted: Record<string, Vec2>; shownB?: Record<string, Vec2>; invertedB?: Record<string, Vec2> }) => {
      if (override) {
        const inv = world.inversions.find(i => i.id === override.id && !i.resolved);
        if (inv) {
          if (inv.variantB) return inv.inverted ? (override.invertedB ?? override.inverted) : (override.shownB ?? override.shown);
          return inv.inverted ? override.inverted : override.shown;
        }
      }
      return base;
    };
    const base = actual === "spread" ? cfg?.spread : cfg?.stack;
    const spots = actual === "spread"
      ? orient(cfg?.spread, cfg?.spreadLightning)
      : orient(cfg?.stack, cfg?.stackLightning);
    const spot = spots?.[player.id] ?? base?.[player.id];
    if (spot) return spot;
  }

  if (hasActiveDoubleTrouble(player, world.time)) {
    const solver = world.botSolvers?.doubleTrouble;
    if (!solver || (solver.startAt !== undefined && world.time < solver.startAt)) return undefined;
    return player.role === "dps"
      ? solver.dps
      : solver.support;
  }

  return undefined;
}

function moveIntent(player: Player, target: Vec2, dt: number) {
  const delta = sub(target, player.pos);
  if (length(delta) > MOVE_SPEED * dt) {
    return { move: normalize(delta) };
  }
  return { move: { x: 0, z: 0 } };
}

export function computeBotIntents(world: World, dt: number): Intents {
  const intents: Intents = {};

  for (const player of world.players) {
    if (!player.alive || player.control !== "bot") continue;

    const solverTarget = solverWaypoint(player, world);
    if (solverTarget) {
      intents[player.id] = moveIntent(player, solverTarget, dt);
      continue;
    }

    if (!player.pattern?.length) continue;

    const waypoint = activeWaypoint(player.pattern, world.time, player.botWaypointResumeAfter);
    if (!waypoint) continue;

    intents[player.id] = moveIntent(player, waypoint.pos, dt);
  }

  return intents;
}
