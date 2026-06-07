import type { World, Player, Boss, Arena, ZoneShape, AOEShape, Waymark, PendingEvent, PendingTether, PendingLineLink, PendingTargetedEvent, PendingTower, PendingChain, PendingGroupEvent, PendingInverse, PendingGaze, PendingForcedMarch, PendingEffectBurst } from "../shared/types";
import { vec2 } from "../shared/math";
import { makeSeed, nextRandom } from "../shared/rng";
import type { RaidDef } from "./raidSchema";
import { INITIAL_TANK_THREAT, topThreatTarget } from "./sim";

export const ROLE_HP: Record<Player["role"], number> = { tank: 160, healer: 100, dps: 100 };

function toVec2(arr: [number, number]) {
  return vec2(arr[0], arr[1]);
}

// Cardinal direction constants -> [x, z] vectors. +z = north, +x = east.
const DIRECTION_VECTORS: Record<"up" | "down" | "left" | "right", [number, number]> = {
  up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0],
};

// Assign each player a plant combination from optionals.combinations.plant. Each group lists its
// members explicitly; member i (in order) draws combo i (wrapping). `rng: true` flips a seeded coin
// to swap which group's combo pool each group's members draw from.
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
    members.forEach((id, i) => {
      plan[id] = combos[i % combos.length].map(d => DIRECTION_VECTORS[d]);
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

  const pending: PendingEvent[] = [];
  const pendingTethers: PendingTether[] = [];
  const pendingLineLinks: PendingLineLink[] = [];
  const pendingTargeted: PendingTargetedEvent[] = [];
  const pendingTowers: PendingTower[] = [];
  const pendingChains: PendingChain[] = [];
  const pendingGroups: PendingGroupEvent[] = [];
  const pendingInversions: PendingInverse[] = [];
  const pendingGazes: PendingGaze[] = [];
  const pendingForcedMarches: PendingForcedMarch[] = [];
  const pendingEffectBursts: PendingEffectBurst[] = [];

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
      });
    } else if (e.type === "line_link") {
      pendingLineLinks.push({
        id: `line-link-${index}`,
        t: e.t,
        name: e.name,
        pos: toVec2(e.pos),
        resolveAfter: e.resolveAfter,
        linkDuration: e.linkDuration ?? e.resolveAfter,
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
        id: `inverse-${index}`,
        t: e.t,
        name: e.name,
        telegraph: e.telegraph,
        shownShapes: e.shownShapes.map(toAOEShape),
        hiddenShapes: e.hiddenShapes.map(toAOEShape),
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
    hasMechanics: pending.length > 0 || pendingTethers.length > 0 || pendingLineLinks.length > 0 || pendingTargeted.length > 0 || pendingTowers.length > 0 || pendingChains.length > 0 || pendingGroups.length > 0 || pendingInversions.length > 0 || pendingGazes.length > 0 || pendingForcedMarches.length > 0 || pendingEffectBursts.length > 0,
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
    inversions: [],
    pendingInversions,
    gazes: [],
    pendingGazes,
    forcedMarches: [],
    pendingForcedMarches,
    pendingEffectBursts,
    plantPlan,
  };
}
