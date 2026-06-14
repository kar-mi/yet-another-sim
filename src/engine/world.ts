import type { World, Player, Boss, Arena, ZoneShape, Waymark, ForsakenAssignmentKind, ForsakenGroup, ForsakenPlan } from "@shared/types";
import type { Vec2 } from "@shared/math";
import { makeSeed, nextRandom, randomInt } from "@shared/rng";
import type { RaidDef } from "./raidSchema";
import { INITIAL_TANK_THREAT } from "@shared/constants";
import { topThreatTarget } from "./systems/helpers";
import { toVec2 } from "./eventTransforms";
import { bucketEvent, type Collections } from "./mechanicRegistry";

export const ROLE_HP: Record<Player["role"], number> = { tank: 160, healer: 100, dps: 100 };

function toBotSolvers(raid: RaidDef): World["botSolvers"] {
  const generic = raid.botSolvers?.generic;
  if (!generic) return undefined;

  const toSpots = (spots: Record<string, [number, number]>) =>
    Object.fromEntries(Object.entries(spots).map(([id, pos]) => [id, toVec2(pos)]));

  return {
    generic: generic.map(rule => ({
      when: { ...rule.when },
      startAt: rule.startAt,
      endAt: rule.endAt,
      frame: rule.frame,
      spots: rule.spots && toSpots(rule.spots),
      spot: rule.spot && toVec2(rule.spot),
    })),
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

function normalizedForsakenKind(kind: ForsakenAssignmentKind): "cone" | "stack" | "defamation" {
  return kind === "spread" ? "defamation" : kind;
}

function classifyForsakenPair(assignments: [ForsakenAssignmentKind, ForsakenAssignmentKind]): ForsakenGroup {
  const kinds = assignments.map(normalizedForsakenKind).sort().join("+");
  if (kinds === "cone+stack" || kinds === "defamation+stack" || kinds === "cone+defamation") return "A";
  return "B";
}

function rotateForsakenTowers(
  events: RaidDef["events"],
  forsaken: NonNullable<NonNullable<RaidDef["optionals"]>["combinations"]>["forsaken"],
  rngState: number,
): { events: RaidDef["events"]; rngState: number } {
  if (!forsaken?.towerRng) return { events, rngState };

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

function buildForsakenPlan(
  raid: RaidDef,
  players: Player[],
  rngState: number,
): { plan?: ForsakenPlan; rngState: number } {
  const forsaken = raid.optionals?.combinations?.forsaken;
  if (!forsaken) return { rngState };

  let nextState = rngState;
  let patternIndex = 0;
  if (forsaken.rng && forsaken.patterns.length > 1) {
    const roll = randomInt(nextState, forsaken.patterns.length);
    nextState = roll.state;
    patternIndex = roll.value;
  }

  const pattern = forsaken.patterns[patternIndex] ?? forsaken.patterns[0]!;
  const roleById = new Map(players.map(player => [player.id, player.role]));
  const pairs = pattern.pairs.map((pair, pairIndex) => {
    const assignments = pair.assignments as [ForsakenAssignmentKind, ForsakenAssignmentKind];
    return {
      id: `pair-${pairIndex + 1}`,
      members: pair.members,
      assignments,
      group: classifyForsakenPair(assignments),
    };
  });
  const playersById: ForsakenPlan["players"] = {};
  for (const [pairIndex, pair] of pairs.entries()) {
    pair.members.forEach((playerId, memberIndex) => {
      const roleSide = roleById.get(playerId) === "dps" ? "dps" : "support";
      const towerGroupBySlot = forsaken.towerOrder.map(group => group === pair.group ? "X" : "Y");
      playersById[playerId] = {
        playerId,
        pairId: pair.id,
        pairIndex,
        assignment: pair.assignments[memberIndex],
        group: pair.group,
        roleSide,
        defaultSide: roleSide === "support" ? "left" : "right",
        towerSlots: forsaken.towerOrder.map((group, i) => group === pair.group ? i + 1 : 0).filter(slot => slot > 0),
        towerGroupBySlot,
      };
    });
  }

  return {
    plan: {
      patternId: pattern.id,
      patternIndex,
      rng: forsaken.rng,
      towerOrder: forsaken.towerOrder,
      pairs,
      players: playersById,
    },
    rngState: nextState,
  };
}

function toZoneShape(zone: RaidDef["arena"]["zones"][number]): ZoneShape {
  switch (zone.kind) {
    case "circle": return { kind: "circle", center: toVec2(zone.center), radius: zone.radius };
    case "rect": return { kind: "rect", center: toVec2(zone.center), width: zone.width, height: zone.height };
    case "polygon": return { kind: "polygon", vertices: zone.vertices.map(toVec2) };
  }
}

export function createWorld(raid: RaidDef, seed: number = makeSeed()): World {
  const arena: Arena = { zones: raid.arena.zones.map(toZoneShape) };
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
    invincible: false,
    alive: true,
    effects: [],
  }));

  const threat: Record<string, number> = {};
  for (const p of players) {
    if (p.alive) threat[p.id] = p.role === "tank" ? INITIAL_TANK_THREAT : 0;
  }
  const boss: Boss = {
    id: "boss",
    pos: toVec2(raid.boss.pos),
    hp: 1000, maxHp: 1000,
    radius: raid.boss.radius,
    facing: 0, threat, currentTarget: topThreatTarget(players, threat),
    ringScale: raid.boss.ring.scale,
    ringColor: raid.boss.ring.color,
  };

  const { plan: plantPlan, rngState: afterPlantRngState } = buildPlantPlan(raid, seed);
  const { plan: forsakenPlan, rngState: afterForsakenRngState } = buildForsakenPlan(raid, players, afterPlantRngState);
  const { events: effectiveEvents, rngState } = rotateForsakenTowers(raid.events, raid.optionals?.combinations?.forsaken, afterForsakenRngState);
  const plantDebuffOrder = raid.optionals?.combinations?.plant?.debuffOrder;

  // Generic-solver partner/group maps. Forsaken is the only current producer, but these are plain
  // fields any pairing/grouping mechanic can populate; the generic solver never reads forsakenPlan.
  const partners: Record<string, string> = {};
  const playerGroups: Record<string, string> = {};
  if (forsakenPlan) {
    for (const pair of forsakenPlan.pairs) {
      partners[pair.members[0]] = pair.members[1];
      partners[pair.members[1]] = pair.members[0];
    }
    for (const [id, assignment] of Object.entries(forsakenPlan.players)) {
      playerGroups[id] = assignment.group;
    }
  }

  // One collection per World pending/resolver field; keys match the World field names exactly so the
  // return can `...collections` and TypeScript enforces the mapping. The mechanic registry owns how
  // each event type buckets into these (see mechanicRegistry.ts).
  const collections: Collections = {
    pending: [],
    pendingTethers: [],
    pendingLineLinks: [],
    pendingTargeted: [],
    pendingBaits: [],
    pendingTowers: [],
    pendingChains: [],
    pendingGroups: [],
    pendingEffectSelects: [],
    pendingApplyEffects: [],
    pendingInversions: [],
    pendingSpreadStacks: [],
    pendingGazes: [],
    pendingForcedMarches: [],
    pendingEffectBursts: [],
    pendingHeals: [],
    pendingForsakenAssigns: [],
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
    players,
    boss,
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
    ...collections,
    plantPlan,
    plantDebuffOrder,
    forsakenPlan,
    botSolvers: toBotSolvers(raid),
    partners,
    playerGroups,
    eventPositions,
  };
}
