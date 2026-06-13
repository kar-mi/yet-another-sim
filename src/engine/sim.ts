// The deterministic simulation step. `tick` is a pure function of (world, intents, dt): it clones
// the incoming world into a TickContext, runs each per-mechanic system in a FIXED order, then
// assembles a fresh world snapshot. The order matters because the seeded PRNG is drawn in sequence
// (see systems/context.ts) — reordering systems changes RNG outcomes and breaks reproducibility.
//
// Each mechanic family lives in its own system under ./systems. This file only orchestrates them.

import type { World, Intents, PendingHeal } from "@shared/types";
import { atan2 } from "@shared/dmath";
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
import { resolveForsakenAssigns } from "./systems/forsakenAssign";
import { resolveInversions } from "./systems/inverse";
import { resolveSpreadStacks } from "./systems/spreadStack";
import { resolveGazes } from "./systems/gaze";
import { applyStatusEffects } from "./systems/statusEffects";

// RNG-CRITICAL execution order — the systems below draw the shared seeded PRNG in this exact
// sequence (see systems/context.ts). Reordering changes which mechanic gets which random value and
// breaks cross-engine reproducibility; determinism.test.ts guards it. This names the order the
// `resolve*` calls in `tick` must follow.
const SYSTEM_ORDER = [
  "forcedMarch", "tethers", "lineLinks", "chains", "aoe", "towers", "groups",
  "effectSelect", "applyEffects", "forsakenAssign", "inverse", "spreadStack", "gaze",
] as const;

// Clear-detection, derived by iteration instead of one hand-maintained conjunction: a pull is
// "resolved" when EVERY mechanic family has drained its pending queue and finished its active items.
// Each predicate reads the freshly-assembled next world. Adding a mechanic = add one entry here.
// (Pure read — iteration order does not affect RNG.)
const MECHANIC_RESOLVED: ReadonlyArray<(w: World) => boolean> = [
  w => w.pending.length === 0 && w.active.every(m => m.resolved),
  w => w.pendingTethers.length === 0 && w.tetherSources.every(ts => ts.finalized),
  w => w.pendingLineLinks.length === 0 && w.lineLinks.every(link => link.resolved),
  w => w.pendingTargeted.length === 0,
  w => w.pendingBaits.length === 0,
  w => w.pendingTowers.length === 0 && w.towers.every(t => t.resolved),
  w => w.pendingChains.length === 0 && w.chains.every(c => c.outcome !== undefined),
  w => w.pendingGroups.length === 0 && w.groupMechanics.every(g => g.resolved),
  w => w.pendingEffectSelects.length === 0,
  w => w.pendingApplyEffects.length === 0,
  w => w.pendingInversions.length === 0 && w.inversions.every(i => i.resolved),
  w => w.pendingSpreadStacks.length === 0 && w.spreadStacks.every(s => s.resolved),
  w => w.pendingGazes.length === 0 && w.gazes.every(g => g.resolved),
  w => w.pendingForcedMarches.length === 0 && w.forcedMarches.every(fm => fm.triggered),
  w => w.pendingEffectBursts.length === 0,
  w => w.pendingHeals.length === 0,
  w => w.pendingForsakenAssigns.length === 0,
];

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
    boss.facing = atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z);
  }

  // Per-mechanic systems, in the fixed RNG-critical order declared by SYSTEM_ORDER (do not reorder).
  const pendingForcedMarches = resolveForcedMarches(ctx);
  const { tetherSources, pendingTethers } = resolveTethers(ctx);
  const { lineLinks, pendingLineLinks } = resolveLineLinks(ctx);
  const { chains, pendingChains } = resolveChains(ctx);
  const { active, pending, pendingTargeted, pendingBaits, pendingEffectBursts } = resolveAoe(ctx);
  const { towers, pendingTowers } = resolveTowers(ctx);
  const { groupMechanics, pendingGroups } = resolveGroups(ctx);
  const pendingEffectSelects = resolveEffectSelects(ctx);
  const pendingApplyEffects = resolveApplyEffects(ctx);
  const pendingForsakenAssigns = resolveForsakenAssigns(ctx);
  const { inversions, pendingInversions } = resolveInversions(ctx);
  const { spreadStacks, pendingSpreadStacks } = resolveSpreadStacks(ctx);
  const { gazes, pendingGazes } = resolveGazes(ctx);

  // 4. Continuous status effects, doubleTrouble/plant expiry, effect culling.
  applyStatusEffects(ctx);

  // Assemble the next world snapshot, then derive status from it.
  const next: World = {
    ...world, time, rngState: ctx.rngState, groupChoices: ctx.groupChoices, players, boss,
    active: [...active, ...ctx.resolvedAoeVisuals], pending, log: ctx.log,
    tetherSources, pendingTethers,
    lineLinks, pendingLineLinks,
    pendingTargeted,
    pendingBaits,
    towers, pendingTowers,
    chains, pendingChains,
    groupMechanics, pendingGroups,
    pendingEffectSelects,
    pendingApplyEffects,
    pendingForsakenAssigns,
    inversions, pendingInversions,
    spreadStacks, pendingSpreadStacks,
    gazes, pendingGazes,
    forcedMarches: ctx.forcedMarches, pendingForcedMarches,
    pendingEffectBursts,
    pendingHeals: remainingPendingHeals,
  };

  // 5. Derive status. "cleared" requires every pending and active mechanic to have resolved.
  const anyAlive = players.some(p => p.alive);
  const allResolved = MECHANIC_RESOLVED.every(isResolved => isResolved(next));
  let status = world.status;
  if (status === "running") {
    if (!anyAlive) {
      status = "wiped";
    } else if (world.hasMechanics && allResolved && time >= world.duration) {
      status = "cleared";
    }
  }

  return { ...next, status };
}
