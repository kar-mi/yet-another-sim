import type { Vec2 } from "../math";
import type { Arena, Crystal, Status, Waymark } from "./foundation";
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
  rngState: number;                     // seeded PRNG state (shared/rng.ts), advanced each pull
  groupChoices: Record<string, number>; // group event id -> chosen group index (for linking)
  status: Status;
  hasMechanics: boolean;
  arena: Arena;
  waymarks: Waymark[];
  crystals: Crystal[];
  players: Player[];
  boss: Boss;
  bosses: Boss[];
  log: LogEntry[];
  duration: number;
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
  botHoldUntil?: number; // bots hold position until this time (set when a tower resolves)
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
  // Fired limit cuts, live for their effect duration (bot-solver when.mechanic gates on these).
  limitCuts: ActiveLimitCut[];
};

type WorldSolverState = {
  // Per-player plant directions (one per plant slot), assigned at world creation and stamped onto
  // each plant debuff as it lands so the HUD arrow and trap use the player's assigned heading.
  plantPlan: Record<string, [number, number][]>;
  // Allows application order to differ from the stable displayed/solver combo order.
  plantDebuffOrder?: number[];
  botSolvers?: BotSolvers;
  // Generic pairing/grouping and positioned-event metadata populated at world creation.
  partners: Record<string, string>;
  playerGroups: Record<string, string>;
  initialCharges: Record<string, string>;
  endingOffsets: Record<string, number>;
  eventPositions: Record<string, Vec2>;
  // Baked Black Hole tether positions and the lazily locked clockwise order used during resolution.
  blackHoleTethers: Record<string, { positions: Vec2[]; orderFrom?: string }>;
  blackHoleTetherOrder: Record<string, Vec2[]>;
};

export type World = WorldCoreState & WorldMechanicState & WorldSolverState;
