import type { World, Player, Boss, Arena, ZoneShape, Waymark } from "@shared/types";
import { vec2, type Vec2 } from "@shared/math";
import { makeSeed, nextRandom, randomInt } from "@shared/rng";
import type { RaidDef } from "./raidSchema";
import { INITIAL_TANK_THREAT, PROVOKE_LEAD } from "@shared/constants";
import { topThreatTarget } from "./systems/helpers";
import { toVec2 } from "./eventTransforms";
import { bucketEvent, type Collections } from "./mechanicRegistry";
import { placeCrystals } from "./crystals";
import { cos, sin } from "@shared/dmath";

export const ROLE_HP: Record<Player["role"], number> = { tank: 160, healer: 100, dps: 100 };

function toBotSolvers(raid: RaidDef): World["botSolvers"] {
  const generic = raid.botSolvers?.generic;
  const holds = raid.botSolvers?.holds;
  if (!generic && !holds) return undefined;

  type AuthoredSpot = { x: number; z: number } | { r: number; z: number }
    | { dist: number; angleDeg: number };
  const toSpot = (spot: AuthoredSpot): Vec2 => {
    if ("angleDeg" in spot) {
      const angle = spot.angleDeg * Math.PI / 180;
      return vec2(spot.dist * sin(angle), spot.dist * cos(angle));
    }
    return "x" in spot ? vec2(spot.x, spot.z) : vec2(spot.r, spot.z);
  };
  const toSpots = (spots: Record<string, AuthoredSpot>) =>
    Object.fromEntries(Object.entries(spots).map(([id, spot]) => [id, toSpot(spot)]));

  return {
    generic: generic?.map(rule => ({
      when: { ...rule.when },
      startAt: rule.startAt,
      endAt: rule.endAt,
      frame: rule.frame,
      mirrorLateral: rule.mirrorLateral,
      spots: rule.spots && toSpots(rule.spots),
      spot: rule.spot && toSpot(rule.spot),
      limitCutSpread: rule.limitCutSpread && { spots: rule.limitCutSpread.spots.map(toSpot) },
    })),
    holds: holds?.map(hold => ({ ...hold })),
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

// Seeded per-run rotation of tower-wave positions around their canonical ring: each wave (towers
// sharing a `t`, named `-left`/`-right`) is remapped to a different canonical position-pair by a
// random start offset + direction. Off unless `towerRng`.
function rotateTowerWaves(
  events: RaidDef["events"],
  towerRng: boolean | undefined,
  rngState: number,
): { events: RaidDef["events"]; rngState: number } {
  if (!towerRng) return { events, rngState };

  const roll1 = randomInt(rngState, 8);
  const startOffset = roll1.value;
  const roll2 = randomInt(roll1.state, 2);
  const direction = roll2.value === 0 ? 1 : -1;
  const nextState = roll2.state;

  const towerEvents = events.filter((e): e is Extract<RaidDef["events"][number], { type: "tower" }> => e.type === "tower");
  const sortedTimes = [...new Set(towerEvents.map(e => e.t))].sort((a, b) => a - b);

  const canonicalPairs = sortedTimes.map(t => {
    const group = towerEvents.filter(e => e.t === t);
    return {
      left: group.find(e => e.id.endsWith("-left"))!.pos,
      right: group.find(e => e.id.endsWith("-right"))!.pos,
    };
  });

  const result = events.map(e => {
    if (e.type !== "tower") return e;
    const waveIdx = sortedTimes.indexOf(e.t);
    const canonIdx = ((startOffset + direction * waveIdx) % 8 + 8) % 8;
    const side = e.id.endsWith("-left") ? "left" : "right";
    return { ...e, pos: canonicalPairs[canonIdx]![side] };
  });

  return { events: result as RaidDef["events"], rngState: nextState };
}

// Select a pairing pattern (seeded when `rng`) and derive the generic maps any mechanic can consume:
// partners (paired player), playerGroups (each pair's declared group label), and initialCharges
// (each member's declared charge kind — the opener deal of the `reassign` event).
function buildPairingPlan(
  raid: RaidDef,
  rngState: number,
): { partners: Record<string, string>; playerGroups: Record<string, string>; initialCharges: Record<string, string>; rngState: number } {
  const pairings = raid.optionals?.combinations?.pairings;
  if (!pairings) return { partners: {}, playerGroups: {}, initialCharges: {}, rngState };

  let nextState = rngState;
  let patternIndex = 0;
  if (pairings.rng && pairings.patterns.length > 1) {
    const roll = randomInt(nextState, pairings.patterns.length);
    nextState = roll.state;
    patternIndex = roll.value;
  }

  const pattern = pairings.patterns[patternIndex] ?? pairings.patterns[0]!;
  const partners: Record<string, string> = {};
  const playerGroups: Record<string, string> = {};
  const initialCharges: Record<string, string> = {};
  for (const pair of pattern.pairs) {
    const [a, b] = pair.members;
    partners[a] = b;
    partners[b] = a;
    if (pair.group) {
      playerGroups[a] = pair.group;
      playerGroups[b] = pair.group;
    }
    if (pair.charges) {
      initialCharges[a] = pair.charges[0];
      initialCharges[b] = pair.charges[1];
    }
  }

  return { partners, playerGroups, initialCharges, rngState: nextState };
}

function toZoneShape(zone: RaidDef["arena"]["zones"][number]): ZoneShape {
  switch (zone.kind) {
    case "circle": return { kind: "circle", center: toVec2(zone.center), radius: zone.radius };
    case "rect": return { kind: "rect", center: toVec2(zone.center), width: zone.width, height: zone.height };
    case "polygon": return { kind: "polygon", vertices: zone.vertices.map(toVec2) };
  }
}

export function createWorld(raid: RaidDef, seed: number = makeSeed()): World {
  const arena: Arena = { zones: raid.arena.zones.map(toZoneShape), floorPlan: raid.arena.floorPlan };
  const waymarks: Waymark[] = raid.waymarks?.map(w => ({ mark: w.mark, pos: toVec2(w.pos) })) ?? [];

  const players: Player[] = raid.players.map(p => ({
    id: p.id,
    role: p.role,
    // Every slot starts as a bot; the server flips it to "human" when a client claims the slot.
    control: "bot",
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
    targetBossId: "",   // filled in below once bosses are built
    invincible: false,
    alive: true,
    effects: [],
  }));

  // Build a boss for each entry in the normalized bosses list. Each boss gets its own threat table.
  const bosses: Boss[] = raid.bosses.map(bossDef => {
    const threat: Record<string, number> = {};
    // Non-targetable bosses hold no threat/aggro — skip seeding entirely.
    if (bossDef.targetable !== false) {
      for (const p of players) {
        if (p.alive) threat[p.id] = p.role === "tank" ? INITIAL_TANK_THREAT : 0;
      }
      // Optional per-boss aggro seed: bump a specific player's threat so this boss faces them first.
      if (bossDef.aggro) {
        const maxThreat = Math.max(0, ...Object.values(threat));
        threat[bossDef.aggro] = maxThreat + PROVOKE_LEAD;
      }
    }
    return {
      id: bossDef.id,
      pos: toVec2(bossDef.pos),
      hp: 1000, maxHp: 1000,
      radius: bossDef.radius,
      facing: 0, threat, currentTarget: bossDef.targetable !== false ? topThreatTarget(players, threat) : null,
      ringScale: bossDef.ring.scale,
      ringColor: bossDef.ring.color,
      model: bossDef.model,
      modelScale: bossDef.modelScale,
      targetable: bossDef.targetable,
    };
  });
  const boss = bosses.find(b => b.targetable !== false) ?? bosses[0]!;
  for (const p of players) p.targetBossId = boss.id;

  const { plan: plantPlan, rngState: afterPlantRngState } = buildPlantPlan(raid, seed);
  // Generic pairing/grouping maps: partners/playerGroups for the bot solver, initialCharges for the
  // reassign opener.
  const { partners, playerGroups, initialCharges, rngState: afterPairingRngState } = buildPairingPlan(raid, afterPlantRngState);
  const { crystals, rngState: afterCrystalRngState } = placeCrystals(raid.crystals, afterPairingRngState);
  const { events: effectiveEvents, rngState } = rotateTowerWaves(raid.events, raid.optionals?.towerRng, afterCrystalRngState);
  const plantDebuffOrder = raid.optionals?.combinations?.plant?.debuffOrder;

  // One collection per World pending/resolver field; keys match the World field names exactly so the
  // return can `...collections` and TypeScript enforces the mapping. The mechanic registry owns how
  // each event type buckets into these (see mechanicRegistry.ts).
  const collections: Collections = {
    pending: [],
    pendingTethers: [],
    pendingLineLinks: [],
    pendingTargeted: [],
    pendingBaits: [],
    pendingDashes: [],
    pendingTowers: [],
    pendingChains: [],
    pendingGroups: [],
    pendingEffectSelects: [],
    pendingApplyEffects: [],
    pendingLimitCuts: [],
    pendingInversions: [],
    pendingSpreadStacks: [],
    pendingGazes: [],
    pendingForcedMarches: [],
    pendingDivebombs: [],
    pendingEffectBursts: [],
    pendingHeals: [],
    pendingSetHps: [],
    reassigns: [],
    effectResolvers: {},
  };
  // Static positions of positioned events, for generic-solver explicit frames (frame: [eventIds]).
  const eventPositions: Record<string, Vec2> = {};

  for (const e of effectiveEvents) {
    bucketEvent(e, collections, eventPositions);
  }

  // `effectResolvers` is a Record (not a pending list), so Array.isArray excludes it: a raid with
  // only effect_resolver events stays hasMechanics:false, matching the previous hand-written OR.
  const hasMechanics = Object.values(collections).some(v => Array.isArray(v) && v.length > 0);

  return {
    time: 0,
    rngState,
    groupChoices: {},
    status: "running",
    hasMechanics,
    arena,
    waymarks,
    crystals,
    players,
    boss,
    bosses,
    log: [],
    duration: raid.duration,
    // Active-mechanic runtime lists; always empty at world creation (resolvers populate them).
    active: [],
    tetherSources: [],
    lineLinks: [],
    towers: [],
    chains: [],
    groupMechanics: [],
    inversions: [],
    spreadStacks: [],
    gazes: [],
    forcedMarches: [],
    divebombs: [],
    limitCuts: [],
    ...collections,
    plantPlan,
    plantDebuffOrder,
    botSolvers: toBotSolvers(raid),
    partners,
    playerGroups,
    initialCharges,
    eventPositions,
  };
}
