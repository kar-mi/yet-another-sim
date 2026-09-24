import type { Vec2 } from "@shared/math";
import type { Arena, Crystal, MechanicSection, Status, Waymark } from "./foundation";
import type { Boss, Player } from "./entities";
import type { BotSolvers } from "./solver";
import type { Reassign } from "./effects";
import type {
  ActiveChain, ActiveDivebomb, ActiveForcedMarch, ActiveGaze, ActiveGroupMechanic,
  ActiveHazard, ActiveInverse, ActiveLimitCut, ActiveLineLink, ActiveMechanic, EffectResolver,
  ActiveSpreadStack, ActiveTower, LogEntry, PendingApplyEffect, PendingBaitEvent,
  PendingBossTeleport, PendingBurstSpreadFollowUp, PendingChain, PendingDashEvent,
  PendingDivebomb, PendingEffectBurst, PendingEffectCheck, PendingEffectSelect,
  PendingEvent, PendingForcedMarch, PendingGaze, PendingGroupEvent, PendingHazard,
  PendingHeal, PendingInverse, PendingLimitCut, PendingLineLink, PendingSetHp,
  PendingSpreadStack, PendingTargetedEvent, PendingTether, PendingTower,
  PendingTwister, TetherSource,
} from "./mechanics";

type WorldCoreState = {
  seed: number;
  time: number;
  rngState: number;
  groupChoices: Record<string, number>;
  status: Status;
  hasMechanics: boolean;
  arena: Arena;
  waymarks: Waymark[];
  crystals: Crystal[];
  players: Player[];
  botsInvisible: boolean;
  boss: Boss;
  bosses: Boss[];
  log: LogEntry[];
  duration: number;
  avoidableSources: Record<string, true>;
  sections: MechanicSection[];
};

type WorldMechanicState = {
  active: ActiveMechanic[];
  pending: PendingEvent[];
  tetherSources: TetherSource[];
  pendingTethers: PendingTether[];
  lineLinks: ActiveLineLink[];
  pendingLineLinks: PendingLineLink[];
  pendingTargeted: PendingTargetedEvent[];
  pendingBaits: PendingBaitEvent[];
  pendingDashes: PendingDashEvent[];
  towers: ActiveTower[];
  pendingTowers: PendingTower[];
  botHoldUntil?: number;
  chains: ActiveChain[];
  pendingChains: PendingChain[];
  groupMechanics: ActiveGroupMechanic[];
  pendingGroups: PendingGroupEvent[];
  inversions: ActiveInverse[];
  pendingInversions: PendingInverse[];
  spreadStacks: ActiveSpreadStack[];
  pendingSpreadStacks: PendingSpreadStack[];
  gazes: ActiveGaze[];
  pendingGazes: PendingGaze[];
  forcedMarches: ActiveForcedMarch[];
  hazards: ActiveHazard[];
  divebombs: ActiveDivebomb[];
  pendingForcedMarches: PendingForcedMarch[];
  pendingHazards: PendingHazard[];
  pendingDivebombs: PendingDivebomb[];
  pendingBossTeleports: PendingBossTeleport[];
  pendingEffectBursts: PendingEffectBurst[];
  pendingEffectChecks: PendingEffectCheck[];
  effectResolvers: Record<string, EffectResolver>;
  pendingHeals: PendingHeal[];
  pendingSetHps: PendingSetHp[];
  reassigns: Reassign[];
  pendingEffectSelects: PendingEffectSelect[];
  pendingApplyEffects: PendingApplyEffect[];
  pendingBurstSpreadFollowUps: PendingBurstSpreadFollowUp[];
  pendingTwisters: PendingTwister[];
  pendingLimitCuts: PendingLimitCut[];
  limitCuts: ActiveLimitCut[];
};

type WorldSolverState = {
  plantPlan: Record<string, [number, number][]>;
  plantDebuffOrder?: number[];
  botSolvers?: BotSolvers;
  partners: Record<string, string>;
  playerGroups: Record<string, string>;
  initialCharges: Record<string, string>;
  endingOffsets: Record<string, number>;
  eventPositions: Record<string, Vec2>;
  blackHoleTethers: Record<string, { positions: Vec2[]; orderFrom?: string }>;
  blackHoleTetherOrder: Record<string, Vec2[]>;
};

export type World = WorldCoreState & WorldMechanicState & WorldSolverState;
