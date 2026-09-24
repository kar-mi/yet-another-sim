import type { World, Player, Boss, Waymark } from "@model/types";
import type { Vec2 } from "@shared/math";
import { makeSeed } from "@shared/rng";
import type { RaidDef } from "./schema/raidSchema";
import { INITIAL_TANK_THREAT, PROVOKE_LEAD } from "@shared/constants";
import { topThreatTarget } from "./systems/helpers";
import { toVec2 } from "./schema/eventTransforms";
import { bucketEvent, type Collections } from "./mechanicRegistry";
import { toBotSolvers } from "./bots/botSolvers";
import { preRollRaid, type RngConstraints } from "./preRoll";
import { collectAvoidableSources } from "./avoidableSources";

export const ROLE_HP: Record<Player["role"], number> = { tank: 160, healer: 100, dps: 100 };

export function createWorld(raid: RaidDef, seed: number = makeSeed(), constraints: RngConstraints = {}): World {
  const arena = raid.arena;
  const waymarks: Waymark[] = raid.waymarks?.map(w => ({ mark: w.mark, pos: toVec2(w.pos) })) ?? [];

  const players: Player[] = raid.players.map(p => ({
    id: p.id,
    role: p.role,
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
    sprintCooldown: 0,
    antiKbCooldown: 0,
    provokeCooldown: 0,
    targetBossId: "",
    invincible: false,
    cooldownsDisabled: false,
    alive: true,
    effects: [],
  }));

  const bosses: Boss[] = raid.bosses.map(bossDef => {
    const threat: Record<string, number> = {};
    if (bossDef.targetable !== false) {
      for (const p of players) {
        if (p.alive) threat[p.id] = p.role === "tank" ? INITIAL_TANK_THREAT : 0;
      }
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
      showInBossList: bossDef.showInBossList,
      hidden: bossDef.hidden,
      sinkFraction: bossDef.sink,
    };
  });
  const boss = bosses.find(b => b.targetable !== false) ?? bosses[0]!;
  for (const p of players) p.targetBossId = boss.id;

  const {
    events: effectiveEvents, plantPlan, partners, playerGroups, initialCharges,
    crystals, endingOffsets, blackHoleTethers, rngState,
  } = preRollRaid(raid, seed, constraints);
  const plantDebuffOrder = raid.optionals?.combinations?.plant?.debuffOrder;

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
    pendingTwisters: [],
    reassigns: [],
    effectResolvers: {},
  };
  const eventPositions: Record<string, Vec2> = {};

  for (const e of effectiveEvents) {
    bucketEvent(e, collections, eventPositions);
  }

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
    botsInvisible: false,
    boss,
    bosses,
    log: [],
    duration: raid.duration,
    avoidableSources: collectAvoidableSources(effectiveEvents),
    sections: raid.sections ? [...raid.sections].sort((a, b) => a.t - b.t) : [],
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
