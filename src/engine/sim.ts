// The deterministic simulation step. `tick` is a pure function of (world, intents, dt): it clones
// the incoming world into a TickContext, runs each per-mechanic system in a FIXED order, then
// assembles a fresh world snapshot. The order matters because the seeded PRNG is drawn in sequence
// (see systems/context.ts) — reordering systems changes RNG outcomes and breaks reproducibility.
//
// Each mechanic family lives in its own module in the registry (mechanicRegistry.ts), which defines
// the fixed resolve order. This file only orchestrates: movement/targeting, the registry resolve
// loop, status effects, and status derivation.

import type { World, Intents, PendingHeal } from "@shared/types";
import { atan2 } from "@shared/dmath";
import { createTickContext } from "./systems/context";
import { topThreatTarget } from "./systems/helpers";
import { applyPlayerMovement } from "./systems/playerMovement";
import { applyStatusEffects } from "./systems/statusEffects";
import { holdUntilFromResolves } from "./genericSolver";
import { REGISTRY } from "./mechanicRegistry";

export function tick(world: World, intents: Intents, dt: number): World {
  const ctx = createTickContext(world, intents, dt);
  const { players, boss, time } = ctx;

  // 1. Player movement, cooldowns, confusion/knockback carry, vertical physics.
  applyPlayerMovement(ctx);

  // Pending full-raid heals resolve before targeting so revived HP is reflected this tick. (Heals
  // resolve inline here rather than in the registry loop because targeting below must see them.)
  for (const heal of world.pendingHeals) {
    if (heal.t <= time) {
      for (const player of players) {
        if (player.alive) player.hp = player.maxHp;
      }
    }
  }
  const remainingPendingHeals: PendingHeal[] = world.pendingHeals.filter(heal => heal.t > time);

  // 1b. Boss targeting + facing: pick the top-threat alive player and turn to face them.
  // Per-tick snap (no turn-rate clamp); visual smoothing is done client-side in net.ts.
  // A lockFacing cast freezes the boss's facing for its duration so it matches its telegraph.
  boss.currentTarget = topThreatTarget(players, boss.threat);
  const facingLocked = world.active.some(m =>
    m.lockFacing && !m.resolved && m.telegraphStart <= time && m.resolveAt > time);
  if (boss.currentTarget && !facingLocked) {
    const target = players.find(p => p.id === boss.currentTarget)!;
    boss.facing = atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z);
  }

  // 2-3. Per-mechanic systems run in the fixed RNG-critical REGISTRY order (do not reorder). Each
  // module's resolve returns the World slice(s) it owns, merged into the next snapshot. Resolvers
  // read from ctx.world (the incoming snapshot), so building `next` incrementally is safe.
  const next: World = { ...world, time, players, boss };
  for (const mechanic of REGISTRY) {
    if (mechanic.resolve) Object.assign(next, mechanic.resolve(ctx));
  }

  // 4. Continuous status effects, doubleTrouble/plant expiry, effect culling. May append plant traps
  // to ctx.forcedMarches, so the active forcedMarches are read from ctx after this runs.
  applyStatusEffects(ctx);

  // Finalize ctx-derived fields that settle only after every system + status effects have run.
  next.rngState = ctx.rngState;
  next.groupChoices = ctx.groupChoices;
  next.log = ctx.log;
  next.forcedMarches = ctx.forcedMarches;
  next.active = [...next.active, ...ctx.resolvedAoeVisuals];
  next.pendingHeals = remainingPendingHeals;

  // Authored bot-solver holds: when a matching mechanic resolves this tick, freeze bots briefly.
  const hold = holdUntilFromResolves(next, ctx.previousTime);
  if (hold !== undefined) next.botHoldUntil = Math.max(next.botHoldUntil ?? 0, hold);

  // 5. Derive status. "cleared" requires every mechanic family to have fully resolved.
  const anyAlive = players.some(p => p.alive);
  const allResolved = REGISTRY.every(mechanic => mechanic.isResolved ? mechanic.isResolved(next) : true);
  let status = world.status;
  if (status === "running") {
    if (!anyAlive) {
      status = "wiped";
    } else if (world.hasMechanics && allResolved && time >= world.duration) {
      status = "cleared";
    }
  }
  next.status = status;
  return next;
}
