import type { World, Player, Boss, Arena, ZoneShape, AOEShape, Waymark, PendingEvent, PendingTether, PendingLineLink, PendingTargetedEvent, PendingTower, PendingChain, PendingGroupEvent, PendingEffectSelect, PendingApplyEffect, PendingInverse, PendingSpreadStack, PendingGaze, PendingForcedMarch, PendingEffectBurst, PendingHeal } from "../shared/types";
import { vec2 } from "../shared/math";
import { makeSeed, nextRandom, randomInt } from "../shared/rng";
import type { RaidDef } from "./raidSchema";
import { INITIAL_TANK_THREAT, topThreatTarget } from "./sim";

export const ROLE_HP: Record<Player["role"], number> = { tank: 160, healer: 100, dps: 100 };

function toVec2(arr: [number, number]) {
  return vec2(arr[0], arr[1]);
}

function toBotSolvers(raid: RaidDef): World["botSolvers"] {
  const plantArrows = raid.botSolvers?.plantArrows;
  const doubleTrouble = raid.botSolvers?.doubleTrouble;
  const spreadStack = raid.botSolvers?.spreadStack;
  if (!plantArrows && !doubleTrouble && !spreadStack) return undefined;

  const toSpots = (spots: Record<string, [number, number]>) =>
    Object.fromEntries(Object.entries(spots).map(([id, pos]) => [id, toVec2(pos)]));

  return {
    plantArrows: plantArrows && {
      placements: Object.fromEntries(
        Object.entries(plantArrows.placements).map(([key, pos]) => [
          key,
          typeof pos[0] === "number" ? toVec2(pos as [number, number]) : (pos as [number, number][]).map(toVec2),
        ]),
      ),
    },
    doubleTrouble: doubleTrouble && {
      support: toVec2(doubleTrouble.support),
      dps: toVec2(doubleTrouble.dps),
      startAt: doubleTrouble.startAt,
    },
    spreadStack: spreadStack && {
      spread: toSpots(spreadStack.spread),
      stack: toSpots(spreadStack.stack),
      spreadLightning: spreadStack.spreadLightning && {
        id: spreadStack.spreadLightning.id,
        shown: toSpots(spreadStack.spreadLightning.shown),
        inverted: toSpots(spreadStack.spreadLightning.inverted),
        shownB: spreadStack.spreadLightning.shownB && toSpots(spreadStack.spreadLightning.shownB),
        invertedB: spreadStack.spreadLightning.invertedB && toSpots(spreadStack.spreadLightning.invertedB),
      },
      stackLightning: spreadStack.stackLightning && {
        id: spreadStack.stackLightning.id,
        shown: toSpots(spreadStack.stackLightning.shown),
        inverted: toSpots(spreadStack.stackLightning.inverted),
        shownB: spreadStack.stackLightning.shownB && toSpots(spreadStack.stackLightning.shownB),
        invertedB: spreadStack.stackLightning.invertedB && toSpots(spreadStack.stackLightning.invertedB),
      },
    },
  };
}

// Cardinal direction constants -> [x, z] vectors. +z = north, +x = east.
const DIRECTION_VECTORS: Record<"up" | "down" | "left" | "right", [number, number]> = {
  up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0],
};

// Assign each player a plant combination from optionals.combinations.plant. Each group lists its
// members explicitly; their selected combo pool is shuffled so members draw different combos when
// possible. `rng: true` flips a seeded coin to swap which group's combo pool each group draws from.
function buildPlantPlan(
  raid: RaidDef,
  rngState: number,
): { plan: Record<string, [number, number][]>; rngState: number } {
  const plant = raid.optionals?.combinations?.plant;
  if (!plant) return { plan: {}, rngState };

  let swap = false;
  let nextState = rngState;
  if (plant.rng) {
    const roll = nextRandom(rngState);
    swap = roll.value < 0.5;
    nextState = roll.state;
  }

  const plan: Record<string, [number, number][]> = {};
  const assign = (members: string[], combos: ("up" | "down" | "left" | "right")[][]) => {
    const comboOrder = combos.map((_, i) => i);
    for (let i = comboOrder.length - 1; i > 0; i--) {
      const roll = randomInt(nextState, i + 1);
      nextState = roll.state;
      [comboOrder[i], comboOrder[roll.value]] = [comboOrder[roll.value], comboOrder[i]];
    }
    members.forEach((id, i) => {
      plan[id] = combos[comboOrder[i % comboOrder.length]].map(d => DIRECTION_VECTORS[d]);
    });
  };
  assign(plant.g1.members, swap ? plant.g2.combos : plant.g1.combos);
  assign(plant.g2.members, swap ? plant.g1.combos : plant.g2.combos);
  return { plan, rngState: nextState };
}

function toZoneShape(zone: RaidDef["arena"]["zones"][number]): ZoneShape {
  switch (zone.kind) {
    case "circle": return { kind: "circle", center: toVec2(zone.center), radius: zone.radius };
    case "rect": return { kind: "rect", center: toVec2(zone.center), width: zone.width, height: zone.height };
    case "polygon": return { kind: "polygon", vertices: zone.vertices.map(toVec2) };
  }
}

type AOEEventDef = Extract<RaidDef["events"][number], { type: "aoe" }>;

function toAOEShape(shape: AOEEventDef["shape"]): AOEShape {
  switch (shape.kind) {
    case "circle": return { kind: "circle", center: toVec2(shape.center), radius: shape.radius };
    case "donut": return { kind: "donut", center: toVec2(shape.center), inner: shape.inner, outer: shape.outer };
    case "cone": return { kind: "cone", origin: toVec2(shape.origin), direction: toVec2(shape.direction), angleDeg: shape.angleDeg, length: shape.length };
    case "rect": return { kind: "rect", origin: toVec2(shape.origin), direction: toVec2(shape.direction), width: shape.width, length: shape.length };
  }
}

export function createWorld(raid: RaidDef, seed: number = makeSeed()): World {
  const arena: Arena = { zones: raid.arena.zones.map(toZoneShape) };
  const waymarks: Waymark[] = raid.waymarks?.map(w => ({ mark: w.mark, pos: toVec2(w.pos) })) ?? [];

  const players: Player[] = raid.players.map(p => ({
    id: p.id,
    role: p.role,
    control: p.control,
    pattern: p.pattern?.map(waypoint => ({ t: waypoint.t, pos: toVec2(waypoint.pos) })),
    pos: toVec2(p.spawn),
    y: 0,
    verticalVelocity: 0,
    knockbackVelocity: { x: 0, z: 0 },
    facing: 0,
    hp: ROLE_HP[p.role],
    maxHp: ROLE_HP[p.role],
    mp: 10000,
    maxMp: 10000,
    sprintActive: 0,
    sprintCooldown: 0,
    antiKbActive: 0,
    antiKbCooldown: 0,
    provokeCooldown: 0,
    invincible: false,
    alive: true,
    effects: [],
  }));

  const threat: Record<string, number> = {};
  for (const p of players) {
    if (p.alive) threat[p.id] = p.role === "tank" ? INITIAL_TANK_THREAT : 0;
  }
  const boss: Boss = {
    id: "boss", pos: { x: 0, z: 0 }, hp: 1000, maxHp: 1000, radius: 3,
    facing: 0, threat, currentTarget: topThreatTarget(players, threat),
  };

  const { plan: plantPlan, rngState } = buildPlantPlan(raid, seed);
  const plantDebuffOrder = raid.optionals?.combinations?.plant?.debuffOrder;

  const pending: PendingEvent[] = [];
  const pendingTethers: PendingTether[] = [];
  const pendingLineLinks: PendingLineLink[] = [];
  const pendingTargeted: PendingTargetedEvent[] = [];
  const pendingTowers: PendingTower[] = [];
  const pendingChains: PendingChain[] = [];
  const pendingGroups: PendingGroupEvent[] = [];
  const pendingEffectSelects: PendingEffectSelect[] = [];
  const pendingApplyEffects: PendingApplyEffect[] = [];
  const pendingInversions: PendingInverse[] = [];
  const pendingSpreadStacks: PendingSpreadStack[] = [];
  const pendingGazes: PendingGaze[] = [];
  const pendingForcedMarches: PendingForcedMarch[] = [];
  const pendingEffectBursts: PendingEffectBurst[] = [];
  const pendingHeals: PendingHeal[] = [];

  for (const [index, e] of raid.events.entries()) {
    if (e.type === "tether_source") {
      pendingTethers.push({
        id: `tether-${index}`,
        t: e.t,
        pos: toVec2(e.pos),
        finalizeAfter: e.finalizeAfter,
        tetherKind: e.tetherKind,
        buffName: e.buffName,
        behavior: e.behavior,
        effectDuration: e.effectDuration,
        icon: e.icon,
      });
    } else if (e.type === "line_link") {
      pendingLineLinks.push({
        id: e.id ?? `line-link-${index}`,
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
        knockback: e.knockback && {
          distance: e.knockback.distance,
          height: e.knockback.height,
          origin: e.knockback.origin ? toVec2(e.knockback.origin) : undefined,
        },
        visual: e.visual,
      });
    } else if (e.type === "targeted") {
      pendingTargeted.push({
        id: `targeted-${index}`,
        t: e.t,
        name: e.name,
        targetMode: e.targetMode,
        role: e.role,
        radius: e.radius,
        telegraph: e.telegraph,
        damage: e.damage,
        damageType: e.damageType,
        applyEffect: e.applyEffect,
        showCastBar: e.showCastBar ?? false,
        showTelegraph: e.showTelegraph ?? true,
      });
    } else if (e.type === "tower") {
      pendingTowers.push({
        id: `tower-${index}`,
        t: e.t,
        name: e.name,
        telegraph: e.telegraph,
        pos: toVec2(e.pos),
        radius: e.radius,
        requiredCount: e.requiredCount,
        requiredRoles: e.requiredRoles,
        wrongRoleLethal: e.wrongRoleLethal ?? false,
        failureDamage: e.failureDamage,
        failureDamageType: e.failureDamageType,
        applyEffect: e.applyEffect,
        knockback: e.knockback && {
          distance: e.knockback.distance,
          height: e.knockback.height,
          origin: e.knockback.origin ? toVec2(e.knockback.origin) : undefined,
        },
        visual: {
          pillar: e.visual?.pillar ?? false,
          countCircles: e.visual?.countCircles ?? false,
          fallingCylinder: e.visual?.fallingCylinder ?? false,
          groundStyle: e.visual?.groundStyle ?? "standard",
          cylinderColor: e.visual?.cylinderColor,
          cylinderThickness: e.visual?.cylinderThickness,
        },
      });
    } else if (e.type === "group") {
      pendingGroups.push({
        id: e.id ?? `group-${index}`,
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
      });
    } else if (e.type === "effect_select") {
      pendingEffectSelects.push({
        id: e.id ?? `effect-select-${index}`,
        t: e.t,
        name: e.name,
        groups: e.groups,
        rng: e.rng ?? false,
        link: e.link,
        applyEffect: e.applyEffect,
      });
    } else if (e.type === "apply_effect") {
      pendingApplyEffects.push({
        t: e.t,
        name: e.name,
        role: e.role,
        players: e.players,
        count: e.count,
        rng: e.rng ?? false,
        applyEffect: e.applyEffect,
      });
    } else if (e.type === "chain") {
      e.pairs.forEach(([a, b], pairIndex) => {
        pendingChains.push({
          id: `chain-${index}-${pairIndex}`,
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
    } else if (e.type === "inverse") {
      pendingInversions.push({
        id: e.id ?? `inverse-${index}`,
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
        rng: e.rng ?? false,
        questionMark: e.questionMark,
        damage: e.damage,
        damageType: e.damageType,
        applyEffect: e.applyEffect,
        knockback: e.knockback && {
          distance: e.knockback.distance,
          height: e.knockback.height,
          origin: e.knockback.origin ? toVec2(e.knockback.origin) : undefined,
        },
        showCastBar: e.showCastBar ?? false,
      });
    } else if (e.type === "spread_stack") {
      pendingSpreadStacks.push({
        id: `spread-stack-${index}`,
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
    } else if (e.type === "gaze") {
      pendingGazes.push({
        id: `gaze-${index}`,
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
        knockback: e.knockback && {
          distance: e.knockback.distance,
          height: e.knockback.height,
          origin: e.knockback.origin ? toVec2(e.knockback.origin) : undefined,
        },
        showCastBar: e.showCastBar ?? false,
        visual: e.visual,
      });
    } else if (e.type === "effect_burst") {
      pendingEffectBursts.push({
        id: `effect-burst-${index}`,
        t: e.t,
        name: e.name,
        telegraph: e.telegraph,
        effectName: e.effectName,
        radius: e.radius,
        damage: e.damage,
        damageType: e.damageType,
        applyEffect: e.applyEffect,
        knockback: e.knockback && {
          distance: e.knockback.distance,
          height: e.knockback.height,
          origin: e.knockback.origin ? toVec2(e.knockback.origin) : undefined,
        },
        showCastBar: e.showCastBar ?? false,
        showTelegraph: e.showTelegraph ?? true,
      });
    } else if (e.type === "forced_march") {
      pendingForcedMarches.push({
        id: `forced-march-${index}`,
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
    } else if (e.type === "heal") {
      pendingHeals.push({
        id: `heal-${index}`,
        t: e.t,
        name: e.name,
      });
    } else {
      pending.push({
        id: `event-${index}`,
        t: e.t,
        name: e.name,
        shape: toAOEShape(e.shape),
        telegraph: e.telegraph,
        damage: e.damage,
        damageType: e.damageType,
        applyEffect: e.applyEffect,
        applyEffects: e.applyEffects,
        knockback: e.knockback && {
          distance: e.knockback.distance,
          height: e.knockback.height,
          origin: e.knockback.origin ? toVec2(e.knockback.origin) : undefined,
        },
        positional: e.positional,
        anchor: e.anchor,
        directionFrom: e.directionFrom,
        directionOffset: e.directionOffset,
        lockFacing: e.lockFacing,
        showCastBar: e.showCastBar ?? false,
        showTelegraph: e.showTelegraph ?? true,
      });
    }
  }

  return {
    time: 0,
    rngState,
    groupChoices: {},
    status: "running",
    hasMechanics: pending.length > 0 || pendingTethers.length > 0 || pendingLineLinks.length > 0 || pendingTargeted.length > 0 || pendingTowers.length > 0 || pendingChains.length > 0 || pendingGroups.length > 0 || pendingEffectSelects.length > 0 || pendingApplyEffects.length > 0 || pendingInversions.length > 0 || pendingSpreadStacks.length > 0 || pendingGazes.length > 0 || pendingForcedMarches.length > 0 || pendingEffectBursts.length > 0 || pendingHeals.length > 0,
    arena,
    waymarks,
    players,
    boss,
    active: [],
    pending,
    log: [],
    duration: raid.duration,
    tetherSources: [],
    pendingTethers,
    lineLinks: [],
    pendingLineLinks,
    pendingTargeted,
    towers: [],
    pendingTowers,
    chains: [],
    pendingChains,
    groupMechanics: [],
    pendingGroups,
    pendingEffectSelects,
    pendingApplyEffects,
    inversions: [],
    pendingInversions,
    spreadStacks: [],
    pendingSpreadStacks,
    gazes: [],
    pendingGazes,
    forcedMarches: [],
    pendingForcedMarches,
    pendingEffectBursts,
    pendingHeals,
    plantPlan,
    plantDebuffOrder,
    botSolvers: toBotSolvers(raid),
  };
}
