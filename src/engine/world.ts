import type { World, Player, Boss, Arena, Waymark } from "@shared/types";
import type { Vec2 } from "@shared/math";
import { makeSeed } from "@shared/rng";
import type { RaidDef } from "./raidSchema";
import { INITIAL_TANK_THREAT, PROVOKE_LEAD } from "@shared/constants";
import { topThreatTarget } from "./systems/helpers";
import { toVec2, toZoneShape } from "./eventTransforms";
import { bucketEvent, type Collections } from "./mechanicRegistry";
import { toBotSolvers } from "./botSolvers";
import { preRollRaid } from "./preRoll";

export const ROLE_HP: Record<Player["role"], number> = { tank: 160, healer: 100, dps: 100 };

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
      hidden: bossDef.hidden,
      sinkFraction: bossDef.sink,
    };
  });
  const boss = bosses.find(b => b.targetable !== false) ?? bosses[0]!;
  for (const p of players) p.targetBossId = boss.id;

  const {
    events: effectiveEvents, plantPlan, partners, playerGroups, initialCharges,
    crystals, endingOffsets, blackHoleTethers, rngState,
  } = preRollRaid(raid, seed);
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
    pendingHazards: [],
    pendingDivebombs: [],
    pendingBossTeleports: [],
    pendingEffectBursts: [],
    pendingEffectChecks: [],
    pendingHeals: [],
    pendingSetHps: [],
    pendingBurstSpreadFollowUps: [],
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
    seed,
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
    hazards: [],
    divebombs: [],
    limitCuts: [],
    ...collections,
    plantPlan,
    plantDebuffOrder,
    botSolvers: toBotSolvers(raid),
    partners,
    playerGroups,
    initialCharges,
    endingOffsets,
    eventPositions,
    blackHoleTethers,
    blackHoleTetherOrder: {},
  };
}
