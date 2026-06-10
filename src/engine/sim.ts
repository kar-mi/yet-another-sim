// The deterministic simulation step. `tick` is a pure function of (world, intents, dt): it clones
// the incoming world into a TickContext, runs each per-mechanic system in a FIXED order, then
// assembles a fresh world snapshot. The order matters because the seeded PRNG is drawn in sequence
// (see systems/context.ts) — reordering systems changes RNG outcomes and breaks reproducibility.
//
// Each mechanic family lives in its own system under ./systems. This file only orchestrates them
// and re-exports the public constants/helpers that other modules import from "./sim".

import type { World, Intents, PendingHeal } from "../shared/types";
import { createTickContext } from "./systems/context";
import { topThreatTarget } from "./systems/helpers";
import { applyPlayerMovement } from "./systems/playerMovement";
import { resolveForcedMarches } from "./systems/forcedMarch";
import { resolveTethers } from "./systems/tethers";
import { resolveLineLinks } from "./systems/lineLinks";
import { resolveChains } from "./systems/chains";
import { resolveAoe } from "./systems/aoe";
import { resolveTowers } from "./systems/towers";
import { resolveGroups } from "./systems/groups";
import { resolveEffectSelects } from "./systems/effectSelect";
import { resolveApplyEffects } from "./systems/applyEffects";
import { resolveInversions } from "./systems/inverse";
import { resolveSpreadStacks } from "./systems/spreadStack";
import { resolveGazes } from "./systems/gaze";
import { applyStatusEffects } from "./systems/statusEffects";

// Re-exported for backward compatibility: world.ts/botIntent.ts/HudOverlay.ts and the tests import
// these from "./sim".
export {
  MOVE_SPEED, SPRINT_MULTIPLIER, JUMP_SPEED, GRAVITY, DEATH_FLOOR_Y,
  SPRINT_DURATION, SPRINT_COOLDOWN, ANTI_KB_DURATION, ANTI_KB_COOLDOWN,
  PROVOKE_COOLDOWN, PROVOKE_LEAD, KNOCKBACK_FRICTION, INITIAL_TANK_THREAT,
} from "./constants";
export { topThreatTarget } from "./systems/helpers";

export function tick(world: World, intents: Intents, dt: number): World {
  const ctx = createTickContext(world, intents, dt);
  const { players, boss, time } = ctx;

  // 1. Player movement, cooldowns, confusion/knockback carry, vertical physics.
  applyPlayerMovement(ctx);

  // Pending full-raid heals resolve before targeting so revived HP is reflected this tick.
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
    boss.facing = Math.atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z);
  }

  // Per-mechanic systems, in fixed order (RNG determinism — do not reorder).
  const pendingForcedMarches = resolveForcedMarches(ctx);
  const { tetherSources, pendingTethers } = resolveTethers(ctx);
  const { lineLinks, pendingLineLinks } = resolveLineLinks(ctx);
  const { chains, pendingChains } = resolveChains(ctx);
  const { active, pending, pendingTargeted, pendingEffectBursts } = resolveAoe(ctx);
  const { towers, pendingTowers } = resolveTowers(ctx);
  const { groupMechanics, pendingGroups } = resolveGroups(ctx);
  const pendingEffectSelects = resolveEffectSelects(ctx);
  const pendingApplyEffects = resolveApplyEffects(ctx);
  const { inversions, pendingInversions } = resolveInversions(ctx);
  const { spreadStacks, pendingSpreadStacks } = resolveSpreadStacks(ctx);
  const { gazes, pendingGazes } = resolveGazes(ctx);

  // 4. Continuous status effects, doubleTrouble/plant expiry, effect culling.
  applyStatusEffects(ctx);

  // 5. Derive status. "cleared" requires every pending and active mechanic to have resolved.
  const anyAlive = players.some(p => p.alive);
  const allResolved = pending.length === 0 && active.every(m => m.resolved)
    && pendingTethers.length === 0 && tetherSources.every(ts => ts.finalized)
    && pendingLineLinks.length === 0 && lineLinks.every(link => link.resolved)
    && pendingTargeted.length === 0
    && pendingTowers.length === 0 && towers.every(t => t.resolved)
    && pendingChains.length === 0 && chains.every(c => c.outcome !== undefined)
    && pendingGroups.length === 0 && groupMechanics.every(g => g.resolved)
    && pendingEffectSelects.length === 0
    && pendingApplyEffects.length === 0
    && pendingInversions.length === 0 && inversions.every(i => i.resolved)
    && pendingSpreadStacks.length === 0 && spreadStacks.every(s => s.resolved)
    && pendingGazes.length === 0 && gazes.every(g => g.resolved)
    && pendingForcedMarches.length === 0 && ctx.forcedMarches.every(fm => fm.triggered)
    && pendingEffectBursts.length === 0
    && remainingPendingHeals.length === 0;
  let status = world.status;
  if (status === "running") {
    if (!anyAlive) {
      status = "wiped";
    } else if (world.hasMechanics && allResolved && time >= world.duration) {
      status = "cleared";
    }
  }

  return {
    ...world, time, rngState: ctx.rngState, groupChoices: ctx.groupChoices, players, boss,
    active: [...active, ...ctx.resolvedAoeVisuals], pending, log: ctx.log, status,
    tetherSources, pendingTethers,
    lineLinks, pendingLineLinks,
    pendingTargeted,
    towers, pendingTowers,
    chains, pendingChains,
    groupMechanics, pendingGroups,
    pendingEffectSelects,
    pendingApplyEffects,
    inversions, pendingInversions,
    spreadStacks, pendingSpreadStacks,
    gazes, pendingGazes,
    forcedMarches: ctx.forcedMarches, pendingForcedMarches,
    pendingEffectBursts,
    pendingHeals: remainingPendingHeals,
  };
}
