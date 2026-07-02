// Mechanic registry — the single source of truth that turns "add a mechanic" from an ~8-file ritual
// into one entry here (+ its zod schema in raidSchema.ts). Each module bundles:
//   - fromEvent:  push a raw event into the world's pending collections (createWorld)
//   - resolve:    advance one tick, returning the World slice(s) it owns (tick); optional
//   - isResolved: clear-detection predicate over the assembled next world; optional
//
// Ownership of event types is declared once in MODULE_FOR_TYPE (below), which `satisfies
// Record<EventType, …>` so the registry is proven to cover every event discriminant at compile time.
//
// IMPORTANT — RNG determinism: the resolve order is the array order of REGISTRY. The seeded PRNG is
// drawn in sequence across systems, so reordering changes every downstream random outcome. The order
// below is the long-standing fixed order (forcedMarch → … → gaze); determinism.test.ts guards it.
// Modules without a `resolve` (heal, effect_resolver) may sit anywhere — they draw no RNG.

import type { World, EffectResolver } from "@shared/types";
import { normalize, type Vec2 } from "@shared/math";
import type { RaidDef } from "./raidSchema";
import type { TickContext } from "./systems/context";
import { toVec2, toAOEShape, toKnockback } from "./eventTransforms";
import { resolveForcedMarches } from "./systems/forcedMarch";
import { resolveTethers } from "./systems/tethers";
import { resolveLineLinks } from "./systems/lineLinks";
import { resolveChains } from "./systems/chains";
import { resolveAoe } from "./systems/aoe";
import { resolveTowers } from "./systems/towers";
import { resolveGroups } from "./systems/groups";
import { resolveEffectSelects } from "./systems/effectSelect";
import { resolveApplyEffects } from "./systems/applyEffects";
import { resolveReassigns } from "./systems/reassign";
import { resolveInversions } from "./systems/inverse";
import { resolveSpreadStacks } from "./systems/spreadStack";
import { resolveGazes } from "./systems/gaze";
import { resolveLimitCuts } from "./systems/limitCut";
import { resolveSetHps } from "./systems/setHp";
import { resolveDivebombs } from "./systems/divebombs";
import { resolveHazards } from "./systems/hazard";
import { resolveBossTeleports } from "./systems/bossTeleport";

type RaidEvent = RaidDef["events"][number];
export type EventType = RaidEvent["type"];

// The mutable pending/resolver collections createWorld populates; keys match World fields exactly.
export type Collections = Pick<World,
  | "pending" | "pendingTethers" | "pendingLineLinks" | "pendingTargeted" | "pendingBaits" | "pendingDashes"
  | "pendingTowers" | "pendingChains" | "pendingGroups" | "pendingEffectSelects"
  | "pendingApplyEffects" | "pendingLimitCuts" | "pendingInversions" | "pendingSpreadStacks" | "pendingGazes"
  | "pendingForcedMarches" | "pendingHazards" | "pendingDivebombs" | "pendingEffectBursts" | "pendingHeals" | "pendingSetHps"
  | "pendingBossTeleports"
  | "pendingBurstSpreadFollowUps" | "reassigns"
  | "effectResolvers"
>;

export interface MechanicModule {
  // Bucket a raw raid event into the world's pending collections. `eventPositions` is the
  // static-position lookup (only `tower` writes it).
  fromEvent(e: RaidEvent, c: Collections, eventPositions: Record<string, Vec2>): void;
  // Advance one tick; returns the World slice(s) this module owns. Omitted for data-only / inline
  // mechanics (effect_resolver has no tick; heal resolves inline in tick before targeting).
  resolve?(ctx: TickContext): Partial<World>;
  // True when this mechanic family has fully resolved (pending drained + active items finished).
  isResolved?(w: World): boolean;
}

const forcedMarch: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "forced_march") return;
    c.pendingForcedMarches.push({
      id: e.id,
      t: e.t,
      name: e.name,
      pos: toVec2(e.pos),
      radius: e.radius,
      direction: toVec2(e.direction),
      distance: e.distance,
      duration: e.duration,
      preDelay: e.preDelay,
      postDelay: e.postDelay,
    });
  },
  // resolveForcedMarches stores the active list on ctx.forcedMarches (statusEffects appends to it
  // later), so the active forcedMarches are read from ctx after all systems run — see tick.
  resolve: ctx => ({ pendingForcedMarches: resolveForcedMarches(ctx) }),
  isResolved: w => w.pendingForcedMarches.length === 0 && w.forcedMarches.every(fm => fm.triggered),
};

const hazard: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "hazard") return;
    if (!e.spots || e.spots.length === 0) {
      throw new Error(`hazard event "${e.id}" resolved with no spots`);
    }
    c.pendingHazards.push({
      id: e.id,
      t: e.t,
      name: e.name,
      spots: e.spots.map(toVec2),
      radius: e.radius,
      duration: e.duration,
      applyEffect: e.applyEffect,
    });
  },
  resolve: ctx => resolveHazards(ctx),
  isResolved: w => w.pendingHazards.length === 0 && w.hazards.length === 0,
};

const tethers: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "tether_source") return;
    c.pendingTethers.push({
      id: e.id,
      t: e.t,
      pos: toVec2(e.pos!),
      finalizeAfter: e.finalizeAfter,
      tetherKind: e.tetherKind,
      buffName: e.buffName,
      behavior: e.behavior,
      effectDuration: e.effectDuration,
      icon: e.icon,
      applyTetherEffect: e.applyTetherEffect,
      showSource: e.showSource,
      beam: e.beam && { ...e.beam, pointing: e.beam.pointing && toVec2(e.beam.pointing) },
    });
  },
  resolve: ctx => resolveTethers(ctx),
  isResolved: w => w.pendingTethers.length === 0 && w.tetherSources.every(ts => ts.finalized),
};

const bossTeleport: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "teleport_boss") return;
    c.pendingBossTeleports.push({
      id: e.id,
      t: e.t,
      name: e.name,
      bossId: e.bossId,
      spots: e.spots.map(toVec2),
      rng: e.rng,
    });
  },
  resolve: ctx => ({ pendingBossTeleports: resolveBossTeleports(ctx) }),
  isResolved: w => w.pendingBossTeleports.length === 0,
};

const lineLinks: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "line_link") return;
    c.pendingLineLinks.push({
      id: e.id,
      t: e.t,
      name: e.name,
      pos: toVec2(e.pos),
      resolveAfter: e.resolveAfter,
      linkDuration: e.linkDuration ?? e.resolveAfter,
      rng: e.rng ?? false,
      link: e.link,
      target: e.target,
      hiddenDebuffName: e.hiddenDebuffName,
      applyEffect: e.applyEffect,
      knockback: e.knockback && toKnockback(e.knockback),
      visual: e.visual,
    });
  },
  resolve: ctx => resolveLineLinks(ctx),
  isResolved: w => w.pendingLineLinks.length === 0 && w.lineLinks.every(link => link.resolved),
};

const chains: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "chain") return;
    e.pairs.forEach(([a, b], pairIndex) => {
      c.pendingChains.push({
        id: e.pairs.length === 1 ? e.id : `${e.id}-${pairIndex}`,
        t: e.t,
        name: e.name,
        a,
        b,
        telegraph: e.telegraph,
        breakWindow: e.breakWindow,
        breakDistance: e.breakDistance,
        breakDamage: e.breakDamage,
        damageType: e.damageType,
        debuffName: e.debuffName,
        showCastBar: e.showCastBar ?? false,
      });
    });
  },
  resolve: ctx => resolveChains(ctx),
  isResolved: w => w.pendingChains.length === 0 && w.chains.every(c => c.outcome !== undefined),
};

// Owns the event types resolved by the AOE pipeline.
const aoe: MechanicModule = {
  fromEvent(e, c) {
    switch (e.type) {
      case "aoe":
        c.pending.push({
          id: e.id,
          t: e.t,
          name: e.name,
          labels: e.labels,
          group: e.group,
          bossId: e.bossId,
          shape: toAOEShape(e.shape),
          telegraph: e.telegraph,
          damage: e.damage,
          damageType: e.damageType,
          applyEffect: e.applyEffect,
          applyEffects: e.applyEffects,
          knockback: e.knockback && toKnockback(e.knockback),
          positional: e.positional,
          anchor: e.anchor,
          directionFrom: e.directionFrom,
          directionOffset: e.directionOffset,
          aimAtPlayer: e.aimAtPlayer,
          lockFacing: e.lockFacing,
          bossStationary: e.bossStationary,
          deferred: e.deferred,
          requireFullHp: e.requireFullHp,
          showCastBar: e.showCastBar ?? false,
          showTelegraph: e.showTelegraph ?? true,
          telegraphMode: e.telegraphMode ?? "cast",
          bossRelativeCenter: e.bossRelativeCenter,
          flashBeforeResolve: e.flashBeforeResolve,
        });
        break;
      case "targeted":
        c.pendingTargeted.push({
          id: e.id,
          t: e.t,
          name: e.name,
          labels: e.labels,
          group: e.group,
          bossId: e.bossId,
          targetMode: e.targetMode,
          role: e.role,
          count: e.count,
          radius: e.radius,
          telegraph: e.telegraph,
          damage: e.damage,
          damageType: e.damageType,
          applyEffect: e.applyEffect,
          showCastBar: e.showCastBar ?? false,
          showTelegraph: e.showTelegraph ?? true,
          telegraphMode: e.telegraphMode ?? "cast",
        });
        break;
      case "bait":
        c.pendingBaits.push({
          id: e.id,
          t: e.t,
          name: e.name,
          labels: e.labels,
          group: e.group,
          bossId: e.bossId,
          targetMode: e.targetMode,
          role: e.role,
          telegraph: e.telegraph,
          link: e.link,
          directionOffsetByEffect: e.directionOffsetByEffect,
          showCastBar: e.showCastBar ?? false,
        });
        break;
      case "dash":
        c.pendingDashes.push({
          id: e.id,
          t: e.t,
          name: e.name,
          labels: e.labels,
          group: e.group,
          bossId: e.bossId,
          telegraph: e.telegraph,
          link: e.link,
          destination: "to" in e.destination
            ? { to: toVec2(e.destination.to) }
            : e.destination,
          showCastBar: e.showCastBar ?? false,
        });
        break;
      case "effect_burst":
        c.pendingEffectBursts.push({
          id: e.id,
          t: e.t,
          name: e.name,
          telegraph: e.telegraph,
          effectName: e.effectName,
          radius: e.radius,
          damage: e.damage,
          damageType: e.damageType,
          applyEffect: e.applyEffect,
          knockback: e.knockback && toKnockback(e.knockback),
          showCastBar: e.showCastBar ?? false,
          showTelegraph: e.showTelegraph ?? true,
          telegraphMode: e.telegraphMode ?? "cast",
        });
        break;
    }
  },
  resolve: ctx => resolveAoe(ctx),
  isResolved: w => w.pending.length === 0 && w.active.every(m => m.resolved)
    && w.pendingTargeted.length === 0
    && w.pendingBaits.length === 0
    && w.pendingDashes.length === 0
    && w.pendingEffectBursts.length === 0,
};

const towers: MechanicModule = {
  fromEvent(e, c, eventPositions) {
    if (e.type !== "tower") return;
    eventPositions[e.id] = toVec2(e.pos);
    c.pendingTowers.push({
      id: e.id,
      t: e.t,
      name: e.name,
      labels: e.labels,
      group: e.group,
      telegraph: e.telegraph,
      pos: toVec2(e.pos),
      radius: e.radius,
      requiredCount: e.requiredCount,
      requiredRoles: e.requiredRoles,
      wrongRoleLethal: e.wrongRoleLethal ?? false,
      failureDamage: e.failureDamage,
      failureDamageType: e.failureDamageType,
      applyEffect: e.applyEffect,
      knockback: e.knockback && toKnockback(e.knockback),
      resolveEventIds: e.resolveEventIds ?? [],
      visual: {
        pillar: e.visual?.pillar ?? false,
        countCircles: e.visual?.countCircles ?? false,
        fallingCylinder: e.visual?.fallingCylinder ?? (e.visual?.fallingObject !== undefined),
        fallingObject: e.visual?.fallingObject ?? (e.visual?.fallingCylinder ? "cylinder" : undefined),
        groundStyle: e.visual?.groundStyle ?? "standard",
        cylinderColor: e.visual?.cylinderColor,
        cylinderThickness: e.visual?.cylinderThickness,
        fallingObjectAlpha: e.visual?.fallingObjectAlpha,
      },
    });
  },
  resolve: ctx => resolveTowers(ctx),
  isResolved: w => w.pendingTowers.length === 0 && w.towers.every(t => t.resolved),
};

const groups: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "group") return;
    c.pendingGroups.push({
      id: e.id,
      t: e.t,
      name: e.name,
      groups: e.groups,
      rng: e.rng ?? false,
      link: e.link,
      telegraph: e.telegraph,
      radius: e.radius,
      requiredCount: e.requiredCount,
      damage: e.damage,
      damageType: e.damageType,
      applyEffect: e.applyEffect,
      showCastBar: e.showCastBar ?? false,
      showMarker: e.showMarker,
      showTelegraph: e.showTelegraph,
    });
  },
  resolve: ctx => resolveGroups(ctx),
  isResolved: w => w.pendingGroups.length === 0 && w.groupMechanics.every(g => g.resolved),
};

const effectSelect: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "effect_select") return;
    c.pendingEffectSelects.push({
      id: e.id,
      t: e.t,
      name: e.name,
      groups: e.groups,
      rng: e.rng ?? false,
      link: e.link,
      applyEffect: e.applyEffect,
    });
  },
  resolve: ctx => ({ pendingEffectSelects: resolveEffectSelects(ctx) }),
  isResolved: w => w.pendingEffectSelects.length === 0,
};

const applyEffects: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "apply_effect") return;
    c.pendingApplyEffects.push({
      id: e.id,
      t: e.t,
      name: e.name,
      role: e.role,
      players: e.players,
      count: e.count,
      assignGroup: e.assignGroup,
      rng: e.rng ?? false,
      applyEffect: e.applyEffect,
      applyEffectChoices: e.applyEffectChoices,
      effectChoiceGroup: e.effectChoiceGroup,
      effectChoiceComplement: e.effectChoiceComplement,
    });
  },
  resolve: ctx => ({ pendingApplyEffects: resolveApplyEffects(ctx) }),
  isResolved: w => w.pendingApplyEffects.length === 0,
};

const limitCut: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "limit_cut") return;
    // Relative-north = opposite Kefka's first divebomb; players place opposite Kefka's rotation.
    // Defaults to N start / CCW (the current hardcoded case) when no rotation config is authored.
    const r = e.rotation;
    const rotation = r
      ? { north: normalize({ x: -toVec2(r.kefkaStart).x, z: -toVec2(r.kefkaStart).z }), clockwise: !r.kefkaClockwise }
      : { north: { x: 0, z: -1 }, clockwise: true };
    c.pendingLimitCuts.push({
      id: e.id,
      t: e.t,
      name: e.name,
      effect: e.effect,
      players: e.players,
      role: e.role,
      rotation,
    });
  },
  resolve: ctx => {
    const { remaining, limitCuts } = resolveLimitCuts(ctx);
    return { pendingLimitCuts: remaining, limitCuts };
  },
  isResolved: w => w.pendingLimitCuts.length === 0,
};

const reassign: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "reassign") return;
    c.reassigns.push({
      id: e.id,
      t: e.t,
      name: e.name,
      charges: e.charges,
      initial: e.initial,
      onResolve: e.onResolve,
      initialDealt: false,
    });
  },
  resolve: ctx => resolveReassigns(ctx),
  // "Resolved" = the opener has fired; later onResolve deals piggyback on tower resolution, which the
  // towers module already gates in clear-detection.
  isResolved: w => w.reassigns.every(r => r.initial !== "plan" || r.initialDealt),
};

const inverse: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "inverse") return;
    c.pendingInversions.push({
      id: e.id,
      t: e.t,
      name: e.name,
      telegraph: e.telegraph,
      shownShapes: e.shownShapes.map(toAOEShape),
      hiddenShapes: e.hiddenShapes.map(toAOEShape),
      shownShapesB: e.shownShapesB?.map(toAOEShape),
      hiddenShapesB: e.hiddenShapesB?.map(toAOEShape),
      variantRng: e.variantRng ?? false,
      ringColor: e.ringColor,
      ringHeight: e.ringHeight,
      telegraphAlpha: e.telegraphAlpha,
      rng: e.rng ?? false,
      questionMark: e.questionMark,
      damage: e.damage,
      damageType: e.damageType,
      applyEffect: e.applyEffect,
      knockback: e.knockback && toKnockback(e.knockback),
      showCastBar: e.showCastBar ?? false,
    });
  },
  resolve: ctx => resolveInversions(ctx),
  isResolved: w => w.pendingInversions.length === 0 && w.inversions.every(i => i.resolved),
};

const spreadStack: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "spread_stack") return;
    c.pendingSpreadStacks.push({
      id: e.id,
      t: e.t,
      name: e.name,
      telegraph: e.telegraph,
      shown: e.shown,
      rng: e.rng ?? false,
      questionMark: e.questionMark,
      damageType: e.damageType,
      spread: { radius: e.spread.radius, damage: e.spread.damage },
      stack: {
        groups: e.stack.groups,
        radius: e.stack.radius,
        requiredCount: e.stack.requiredCount,
        damage: e.stack.damage,
      },
      ringColor: e.ringColor,
      ringHeight: e.ringHeight,
      showCastBar: e.showCastBar ?? false,
    });
  },
  resolve: ctx => resolveSpreadStacks(ctx),
  isResolved: w => w.pendingSpreadStacks.length === 0 && w.spreadStacks.every(s => s.resolved),
};

const gaze: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "gaze") return;
    c.pendingGazes.push({
      id: e.id,
      t: e.t,
      name: e.name,
      telegraph: e.telegraph,
      pos: toVec2(e.pos),
      reverse: e.reverse ?? false,
      rng: e.rng ?? false,
      coneHalfAngle: e.coneHalfAngle ?? Math.PI / 2,
      damage: e.damage,
      damageType: e.damageType,
      applyEffect: e.applyEffect,
      knockback: e.knockback && toKnockback(e.knockback),
      showCastBar: e.showCastBar ?? false,
      visual: e.visual,
    });
  },
  resolve: ctx => resolveGazes(ctx),
  isResolved: w => w.pendingGazes.length === 0 && w.gazes.every(g => g.resolved),
};

const divebomb: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "divebomb") return;
    const gap = e.gap ?? e.size * 1.5;
    c.pendingDivebombs.push({
      id: e.id,
      t: e.t,
      name: e.name,
      from: toVec2(e.from),
      to: toVec2(e.to),
      speed: e.speed,
      size: e.size,
      color: e.color,
      gap,
      damage: e.damage,
      damageType: e.damageType,
      applyEffect: e.applyEffect,
      hitInterval: e.hitInterval ?? gap / e.speed,
      teleportBoss: e.teleportBoss,
      hideBoss: e.hideBoss,
      visual: e.visual,
    });
  },
  resolve: ctx => resolveDivebombs(ctx),
  isResolved: w => w.pendingDivebombs.length === 0 && w.divebombs.every(db => db.resolved),
};

const setHp: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "set_hp") return;
    c.pendingSetHps.push({ id: e.id, t: e.t, name: e.name, amount: e.amount, role: e.role, players: e.players });
  },
  resolve: ctx => ({ pendingSetHps: resolveSetHps(ctx) }),
  isResolved: w => w.pendingSetHps.length === 0,
};

// Full-raid heals resolve inline in tick (before targeting, so revived HP is targetable this tick),
// so this module has no `resolve` — only bucketing + clear-detection.
const heal: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "heal") return;
    c.pendingHeals.push({ id: e.id, t: e.t, name: e.name });
  },
  isResolved: w => w.pendingHeals.length === 0,
};

// Effect resolvers are a lookup table consumed by other systems (e.g. towers); they have no tick of
// their own and never gate clear-detection.
const effectResolver: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "effect_resolver") return;
    c.effectResolvers[e.id] = {
      id: e.id,
      name: e.name,
      effectName: e.effectName,
      action: e.action,
    } satisfies EffectResolver;
  },
};

// COMPILE-TIME COVERAGE: every event discriminant must map to its owning module. `satisfies
// Record<EventType, …>` makes adding a new event type to EventSchema without registering it here a
// TYPE error (missing key) rather than a silent runtime gap. This is also the dispatch source.
const MODULE_FOR_TYPE = {
  forced_march: forcedMarch,
  tether_source: tethers,
  teleport_boss: bossTeleport,
  line_link: lineLinks,
  chain: chains,
  aoe: aoe,
  targeted: aoe,
  bait: aoe,
  dash: aoe,
  effect_burst: aoe,
  tower: towers,
  group: groups,
  effect_select: effectSelect,
  apply_effect: applyEffects,
  limit_cut: limitCut,
  reassign: reassign,
  inverse: inverse,
  spread_stack: spreadStack,
  gaze: gaze,
  hazard: hazard,
  set_hp: setHp,
  heal: heal,
  effect_resolver: effectResolver,
  divebomb: divebomb,
} satisfies Record<EventType, MechanicModule>;

// Resolve/clear-detection order — RNG-critical (see header). Resolve-bearing modules in the fixed
// legacy order; the data-only modules (heal, effect_resolver) follow.
export const REGISTRY: readonly MechanicModule[] = [
  forcedMarch, tethers, bossTeleport, lineLinks, chains, aoe, towers, groups,
  effectSelect, applyEffects, reassign, inverse, spreadStack, gaze, limitCut,
  hazard, setHp, heal, effectResolver, divebomb,
];

// Invariant: every owning module participates in the REGISTRY loop (so its resolve/isResolved run).
// Catches a module added to MODULE_FOR_TYPE but forgotten in REGISTRY — a silent "never resolves" bug.
for (const mechanic of new Set(Object.values(MODULE_FOR_TYPE))) {
  if (!REGISTRY.includes(mechanic)) {
    throw new Error("mechanicRegistry: a module in MODULE_FOR_TYPE is missing from REGISTRY");
  }
}

const MODULE_BY_TYPE = MODULE_FOR_TYPE as Record<EventType, MechanicModule>;

export function bucketEvent(e: RaidEvent, c: Collections, eventPositions: Record<string, Vec2>): void {
  MODULE_BY_TYPE[e.type].fromEvent(e, c, eventPositions);
}
