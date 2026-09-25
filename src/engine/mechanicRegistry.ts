import type { World, EffectResolver } from "@model/types";
import { normalize, type Vec2 } from "@shared/math";
import type { RaidDef } from "./schema/raidSchema";
import type { TickContext } from "./systems/context";
import { toVec2, toAOEShape, toKnockback } from "./schema/eventTransforms";
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
import { resolveEffectChecks } from "./systems/effectCheck";
import { resolveLimitCuts } from "./systems/limitCut";
import { resolveSetHps } from "./systems/setHp";
import { resolveDivebombs } from "./systems/divebombs";
import { resolveHazards } from "./systems/hazard";
import { resolveBossTeleports } from "./systems/bossTeleport";

type RaidEvent = RaidDef["events"][number];
type EventType = RaidEvent["type"];

export type Collections = Pick<World,
  | "pending" | "pendingTethers" | "pendingLineLinks" | "pendingTargeted" | "pendingBaits" | "pendingDashes"
  | "pendingTowers" | "pendingChains" | "pendingGroups" | "pendingEffectSelects"
  | "pendingApplyEffects" | "pendingLimitCuts" | "pendingInversions" | "pendingSpreadStacks" | "pendingGazes"
  | "pendingForcedMarches" | "pendingHazards" | "pendingDivebombs" | "pendingEffectBursts" | "pendingEffectChecks" | "pendingHeals" | "pendingSetHps"
  | "pendingBossTeleports"
  | "pendingBurstSpreadFollowUps" | "pendingTwisters" | "reassigns"
  | "effectResolvers"
>;

export interface MechanicModule {
  fromEvent(e: RaidEvent, c: Collections, eventPositions: Record<string, Vec2>): void;
  resolve?(ctx: TickContext): Partial<World>;
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
      armingTime: e.armingTime,
      applyEffect: e.applyEffect,
    });
  },
  resolve: ctx => resolveHazards(ctx),
  isResolved: w => w.pendingHazards.length === 0 && w.hazards.length === 0,
};

const tethers: MechanicModule = {
  fromEvent(e, c, eventPositions) {
    if (e.type !== "tether_source") return;
    if (e.pos) eventPositions[e.id] = toVec2(e.pos);
    c.pendingTethers.push({
      id: e.id,
      t: e.t,
      pos: e.pos && toVec2(e.pos),
      fromBlackHoleOrb: e.fromBlackHoleOrb,
      finalizeAfter: e.finalizeAfter,
      fireOffsets: e.fireOffsets,
      despawnAfter: e.despawnAfter,
      tetherKind: e.tetherKind,
      buffName: e.buffName,
      applyEffect: e.applyEffect,
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
      facing: e.facing,
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
      rng: e.rng,
      link: e.link,
      target: e.target,
      hiddenDebuff: e.hiddenDebuff,
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
        debuff: e.debuff,
        showCastBar: e.showCastBar,
      });
    });
  },
  resolve: ctx => resolveChains(ctx),
  isResolved: w => w.pendingChains.length === 0 && w.chains.every(c => c.outcome !== undefined),
};

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
          sideOrbAfter: e.sideOrbAfter,
          aimAtPlayer: e.aimAtPlayer,
          lockFacing: e.lockFacing,
          bossStationary: e.bossStationary,
          deferred: e.deferred,
          requireFullHp: e.requireFullHp,
          onlyCarriers: e.onlyCarriers,
          players: e.players,
          showCastBar: e.showCastBar,
          showTelegraph: e.showTelegraph,
          telegraphMode: e.telegraphMode,
          linger: e.linger,
          bossRelativeCenter: e.bossRelativeCenter,
          flashBeforeResolve: e.flashBeforeResolve,
          color: e.color,
          outline: e.outline,
          telegraphAlpha: e.telegraphAlpha,
          glyph: e.glyph && { at: toVec2(e.glyph.at), kind: e.glyph.kind },
          ring: e.ring && { center: toVec2(e.ring.center), radius: e.ring.radius, kind: e.ring.kind },
          element: e.element,
          vfx: e.vfx,
          mover: e.mover && { from: toVec2(e.mover.from), departAt: e.mover.departAt, scale: e.mover.scale, sprite: e.mover.sprite },
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
          showCastBar: e.showCastBar,
          showTelegraph: e.showTelegraph,
          telegraphMode: e.telegraphMode,
          color: e.color,
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
          showCastBar: e.showCastBar,
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
          showCastBar: e.showCastBar,
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
          innerRadius: e.innerRadius,
          shownShape: e.shownShape,
          hiddenShape: e.hiddenShape,
          rng: e.rng,
          questionMark: e.questionMark,
          damage: e.damage,
          damageType: e.damageType,
          applyEffect: e.applyEffect,
          knockback: e.knockback && toKnockback(e.knockback),
          showCastBar: e.showCastBar,
          showTelegraph: e.showTelegraph,
          telegraphMode: e.telegraphMode,
          color: e.color,
        });
        break;
    }
  },
  resolve: ctx => resolveAoe(ctx),
  isResolved: w => w.pending.length === 0 && w.active.every(m => m.resolved)
    && w.pendingTargeted.length === 0
    && w.pendingBaits.length === 0
    && w.pendingDashes.length === 0
    && w.pendingEffectBursts.length === 0
    && w.pendingTwisters.length === 0,
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
      wrongRoleLethal: e.wrongRoleLethal,
      failureDamage: e.failureDamage,
      failureDamageType: e.failureDamageType,
      applyEffect: e.applyEffect,
      consumeEffect: e.consumeEffect,
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
      rng: e.rng,
      link: e.link,
      telegraph: e.telegraph,
      radius: e.radius,
      requiredCount: e.requiredCount,
      damage: e.damage,
      damageType: e.damageType,
      applyEffect: e.applyEffect,
      showCastBar: e.showCastBar,
      showMarker: e.showMarker,
      showTelegraph: e.showTelegraph,
      color: e.color,
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
      rng: e.rng,
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
      rng: e.rng,
      applyEffect: e.applyEffect,
      applyEffectChoices: e.applyEffectChoices,
      effectChoiceGroup: e.effectChoiceGroup,
      effectChoiceComplement: e.effectChoiceComplement,
    });
  },
  resolve: ctx => ({ pendingApplyEffects: resolveApplyEffects(ctx) }),
  isResolved: w => w.pendingApplyEffects.length === 0,
};

const effectCheck: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "effect_check") return;
    c.pendingEffectChecks.push({ id: e.id, t: e.t, name: e.name, checks: e.checks, failureDamage: e.failureDamage, failureDamageType: e.failureDamageType });
  },
  resolve: ctx => ({ pendingEffectChecks: resolveEffectChecks(ctx) }),
  isResolved: w => w.pendingEffectChecks.length === 0,
};

const limitCut: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "limit_cut") return;
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
      variantRng: e.variantRng,
      ringColor: e.ringColor,
      ringHeight: e.ringHeight,
      telegraphAlpha: e.telegraphAlpha,
      color: e.color,
      rng: e.rng,
      questionMark: e.questionMark,
      damage: e.damage,
      damageType: e.damageType,
      applyEffect: e.applyEffect,
      knockback: e.knockback && toKnockback(e.knockback),
      showCastBar: e.showCastBar,
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
      rng: e.rng,
      questionMark: e.questionMark,
      damageType: e.damageType,
      spread: { radius: e.spread.radius, damage: e.spread.damage },
      stack: {
        groups: e.stack.groups,
        radius: e.stack.radius,
        requiredCount: e.stack.requiredCount,
        damage: e.stack.damage,
      },
      stackCarriers: e.stackCarriers,
      spreadCarriers: e.spreadCarriers,
      ringColor: e.ringColor,
      ringHeight: e.ringHeight,
      showCastBar: e.showCastBar,
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
      pos: e.pos ? toVec2(e.pos) : { x: 0, z: 0 },
      carriers: e.carriers,
      carrierCone: e.carrierCone,
      reverse: e.reverse,
      rng: e.rng,
      coneHalfAngle: e.coneHalfAngle ?? Math.PI / 2,
      damage: e.damage,
      damageType: e.damageType,
      applyEffect: e.applyEffect,
      knockback: e.knockback && toKnockback(e.knockback),
      showCastBar: e.showCastBar,
      visual: e.visual,
      color: e.color,
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

const heal: MechanicModule = {
  fromEvent(e, c) {
    if (e.type !== "heal") return;
    c.pendingHeals.push({ id: e.id, t: e.t, name: e.name });
  },
  resolve: ctx => {
    if (ctx.world.pendingHeals.some(heal => heal.t <= ctx.time)) {
      for (const player of ctx.players) {
        if (player.alive) player.hp = player.maxHp;
      }
    }
    return { pendingHeals: ctx.world.pendingHeals.filter(heal => heal.t > ctx.time) };
  },
  isResolved: w => w.pendingHeals.length === 0,
};

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
  effect_check: effectCheck,
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

export const REGISTRY: readonly MechanicModule[] = [
  heal, forcedMarch, tethers, bossTeleport, lineLinks, chains, aoe, towers, groups,
  effectSelect, applyEffects, effectCheck, reassign, inverse, spreadStack, gaze, limitCut,
  hazard, setHp, effectResolver, divebomb,
];

for (const mechanic of new Set(Object.values(MODULE_FOR_TYPE))) {
  if (!REGISTRY.includes(mechanic)) {
    throw new Error("mechanicRegistry: a module in MODULE_FOR_TYPE is missing from REGISTRY");
  }
}

const MODULE_BY_TYPE = MODULE_FOR_TYPE as Record<EventType, MechanicModule>;

export function bucketEvent(e: RaidEvent, c: Collections, eventPositions: Record<string, Vec2>): void {
  MODULE_BY_TYPE[e.type].fromEvent(e, c, eventPositions);
}
