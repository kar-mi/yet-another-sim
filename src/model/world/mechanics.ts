import type { Vec2 } from "@shared/math";
import type { FloorAoe, Vfx } from "@effects";
import type {
  AOEShape, BossRelativeCenter, DamageType, ElementGlyph, ElementGlyphKind, ElementRing, FlashBeforeResolve, Mover,
  PositionalArc, Role, TelegraphMode,
} from "./foundation";
import type { EffectBundle, EffectSpec, Knockback, Reassign } from "./effects";

export type ActiveMechanic = {
  id: string;
  name: string;
  labels?: string[];
  group?: string;
  bossId?: string;
  shape: AOEShape;
  telegraphStart: number;
  resolveAt: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  applyEffects?: EffectBundle;
  knockback?: Knockback;
  positional?: PositionalArc;
  lockFacing?: boolean;
  bossStationary?: boolean;
  deferred?: boolean;
  armed?: boolean;
  telegraphDuration?: number;
  requireFullHp?: boolean;
  onlyCarriers?: boolean;
  players?: string[];
  anchor?: "boss";
  directionFrom?: "bossFacing";
  directionOffset?: number;
  sideOrbAfter?: string;
  resolved: boolean;
  showCastBar: boolean;
  showTelegraph: boolean;
  telegraphMode?: TelegraphMode;
  floorAoe?: FloorAoe;
  targeting?: { mode: "closest" | "furthest" | "aggro"; role?: Role; origin: Vec2; count?: number };
  lingerFor?: number;
  flashBeforeResolve?: FlashBeforeResolve;
  color?: string;
  outline?: boolean;
  telegraphAlpha?: number;
  glyph?: ElementGlyph;
  ring?: ElementRing;
  mover?: Mover;
  element?: ElementGlyphKind;
  vfx?: Vfx;
};

export type PendingEvent = {
  id: string;
  t: number;
  name: string;
  labels?: string[];
  group?: string;
  bossId?: string;
  shape: AOEShape;
  telegraph: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  applyEffects?: EffectBundle;
  knockback?: Knockback;
  positional?: PositionalArc;
  anchor?: "boss";
  directionFrom?: "bossFacing";
  directionOffset?: number;
  sideOrbAfter?: string;
  aimAtPlayer?: string;
  lockFacing?: boolean;
  bossStationary?: boolean;
  deferred?: boolean;
  requireFullHp?: boolean;
  onlyCarriers?: boolean;
  players?: string[];
  showCastBar: boolean;
  showTelegraph: boolean;
  telegraphMode: TelegraphMode;
  linger?: number;
  bossRelativeCenter?: BossRelativeCenter;
  flashBeforeResolve?: FlashBeforeResolve;
  color?: string;
  outline?: boolean;
  telegraphAlpha?: number;
  glyph?: ElementGlyph;
  ring?: ElementRing;
  element?: ElementGlyphKind;
  mover?: Mover;
  vfx?: Vfx;
};

export type PendingTargetedEvent = {
  id: string;
  t: number;
  name: string;
  labels?: string[];
  group?: string;
  bossId?: string;
  targetMode: "closest" | "furthest" | "aggro";
  role?: Role;
  count?: number;
  radius: number;
  telegraph: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  showCastBar: boolean;
  showTelegraph: boolean;
  telegraphMode: TelegraphMode;
  color?: string;
};


export type PendingBaitEvent = {
  id: string;
  t: number;
  name: string;
  labels?: string[];
  group?: string;
  bossId?: string;
  targetMode: "random" | "closest" | "furthest";
  role?: Role;
  telegraph: number;
  link: string;
  directionOffsetByEffect?: Record<string, number>;
  showCastBar: boolean;
};

export type DashDestination =
  | { to: Vec2 }
  | { debuff: string }
  | { bait: "closest" | "furthest" | "random" | "aggro"; role?: Role };

export type PendingDashEvent = {
  id: string;
  t: number;
  name: string;
  labels?: string[];
  group?: string;
  bossId?: string;
  telegraph: number;
  link: string;
  destination: DashDestination;
  showCastBar: boolean;
  randomTargetId?: string;
};

export type PendingEffectBurst = {
  id: string;
  t: number;
  name: string;
  telegraph: number;
  effectName: string;
  radius: number;
  innerRadius?: number;
  shownShape: "circle" | "donut";
  hiddenShape: "circle" | "donut";
  rng: boolean;
  questionMark?: boolean;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  showCastBar: boolean;
  showTelegraph: boolean;
  telegraphMode: TelegraphMode;
  color?: string;
};

type EffectResolverAction =
  | { kind: "spread"; radius: number; damage: number; damageType: DamageType }
  | { kind: "stack"; radius: number; requiredCount: number; damage: number; damageType: DamageType }
  | { kind: "cone_nearest"; angleDeg: number; length: number; damage: number; damageType: DamageType };

export type EffectResolver = {
  id: string;
  name: string;
  effectName: string;
  action: EffectResolverAction;
};

export type PendingHeal = {
  id: string;
  t: number;
  name: string;
};

export type PendingSetHp = {
  id: string;
  t: number;
  name: string;
  amount: number;
  role?: Role;
  players?: string[];
};

type TowerVisual = {
  pillar: boolean;
  countCircles: boolean;
  fallingCylinder: boolean;
  fallingObject?: "cylinder" | "sphere" | "box";
  groundStyle: "standard" | "tank";
  cylinderColor?: string;
  cylinderThickness?: number;
  fallingObjectAlpha?: number;
};

type TowerEffectConsumption = {
  effectName: string;
  stacks: number;
};

export type PendingTower = {
  id: string;
  t: number;
  name: string;
  labels?: string[];
  group?: string;
  telegraph: number;
  pos: Vec2;
  radius: number;
  requiredCount: number;
  requiredRoles?: Role[];
  wrongRoleLethal: boolean;
  failureDamage: number;
  failureDamageType: DamageType;
  applyEffect?: EffectSpec;
  consumeEffect?: TowerEffectConsumption;
  knockback?: Knockback;
  resolveEventIds: string[];
  visual: TowerVisual;
};

export type ActiveTower = {
  id: string;
  name: string;
  labels?: string[];
  group?: string;
  pos: Vec2;
  radius: number;
  telegraphStart: number;
  resolveAt: number;
  requiredCount: number;
  requiredRoles?: Role[];
  wrongRoleLethal: boolean;
  failureDamage: number;
  failureDamageType: DamageType;
  applyEffect?: EffectSpec;
  consumeEffect?: TowerEffectConsumption;
  knockback?: Knockback;
  resolveEventIds: string[];
  visual: TowerVisual;
  resolved: boolean;
  soakerCount: number;
  outcome?: "success" | "failure";
};


export type PendingInverse = {
  id: string;
  t: number;
  name: string;
  telegraph: number;
  shownShapes: AOEShape[];
  hiddenShapes: AOEShape[];
  shownShapesB?: AOEShape[];
  hiddenShapesB?: AOEShape[];
  variantRng?: boolean;
  ringColor?: string;
  ringHeight?: number;
  telegraphAlpha?: number;
  color?: string;
  rng: boolean;
  questionMark?: boolean;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  showCastBar: boolean;
};

export type ActiveInverse = {
  id: string;
  name: string;
  shownShapes: AOEShape[];
  hiddenShapes: AOEShape[];
  ringColor?: string;
  ringHeight?: number;
  telegraphAlpha?: number;
  floorAoes?: FloorAoe[];
  inverted: boolean;
  variantB: boolean;
  telegraphStart: number;
  resolveAt: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  showCastBar: boolean;
  resolved: boolean;
};

type SpreadStackMode = "spread" | "stack";
type SpreadStackShown = SpreadStackMode | "random";

type SpreadConfig = { radius: number; damage: number };
type StackConfig = { groups: string[][]; radius: number; requiredCount: number; damage: number };

export type PendingSpreadStack = {
  id: string;
  t: number;
  name: string;
  telegraph: number;
  shown: SpreadStackShown;
  rng: boolean;
  questionMark?: boolean;
  damageType: DamageType;
  spread: SpreadConfig;
  stack: StackConfig;
  stackCarriers?: string;
  spreadCarriers?: string;
  ringColor?: string;
  ringHeight?: number;
  showCastBar: boolean;
};

export type ActiveSpreadStack = {
  id: string;
  name: string;
  telegraphStart: number;
  resolveAt: number;
  shown: SpreadStackMode;
  inverted: boolean;
  markedPlayerIds: string[];
  spread: SpreadConfig;
  stack: StackConfig;
  spreadPlayerIds?: string[];
  damageType: DamageType;
  ringColor?: string;
  ringHeight?: number;
  showCastBar: boolean;
  resolved: boolean;
  outcome?: "success" | "failure";
};

type GazeVisual = { width: number; height: number; depth: number };
type CarrierCone = { angleDeg: number; length: number };

export type PendingGaze = {
  id: string;
  t: number;
  name: string;
  telegraph: number;
  pos: Vec2;
  carriers?: string;
  carrierCone?: CarrierCone;
  reverse: boolean;
  rng: boolean;
  coneHalfAngle: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  showCastBar: boolean;
  visual?: GazeVisual;
  color?: string;
};

export type ActiveGaze = {
  id: string;
  name: string;
  pos: Vec2;
  excludePlayerId?: string;
  carrierId?: string;
  direction?: Vec2;
  carrierCone?: CarrierCone;
  reverse: boolean;
  coneHalfAngle: number;
  telegraphStart: number;
  resolveAt: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  showCastBar: boolean;
  visual?: GazeVisual;
  resolved: boolean;
  floorAoe?: FloorAoe;
};

export type PendingGroupEvent = {
  id: string;
  t: number;
  name: string;
  groups: string[][];
  rng: boolean;
  link?: string;
  telegraph: number;
  radius: number;
  requiredCount: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  showCastBar: boolean;
  showMarker: boolean;
  showTelegraph: boolean;
  color?: string;
};

export type PendingEffectSelect = {
  id: string;
  t: number;
  name: string;
  groups: string[][];
  rng: boolean;
  link?: string;
  applyEffect: EffectSpec;
};

export type PendingLimitCut = {
  id: string;
  t: number;
  name: string;
  effect: EffectSpec;
  players?: string[];
  role?: Role;
  rotation: { north: Vec2; clockwise: boolean };
};

export type ActiveLimitCut = {
  id: string;
  appliedAt: number;
  duration: number;
  north: Vec2;
  clockwise: boolean;
};

export type PendingApplyEffect = {
  id: string;
  t: number;
  name: string;
  role?: Role;
  players?: string[];
  count?: number;
  assignGroup?: string;
  rng: boolean;
  applyEffect?: EffectSpec;
  applyEffectChoices?: [EffectSpec, EffectSpec];
  effectChoiceGroup?: string;
  effectChoiceComplement?: boolean;
};

export type { PendingFollowUp as PendingBurstSpreadFollowUp, PendingTwister } from "@status";

export type ActiveGroupMechanic = {
  id: string;
  name: string;
  telegraphStart: number;
  resolveAt: number;
  markedPlayerId: string;
  radius: number;
  requiredCount: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  resolved: boolean;
  showCastBar: boolean;
  showMarker: boolean;
  showTelegraph: boolean;
  color?: string;
  floorAoe?: FloorAoe;
  outcome?: "success" | "failure";
};

export type LogEntry = {
  t: number;
  mechanic: string;
  playerId: string;
  event: "hit" | "fell" | "cleared" | "avoidableHit" | "death";
  source?: string;
  hpLoss?: number;
};

export type TetherSource = {
  id: string;
  pos: Vec2;
  spawnAt: number;
  finalizeAt: number;
  fireTimes: number[];
  nextFireIndex: number;
  expireAt?: number;
  tetherKind: "buff" | "debuff";
  buffName: string;
  applyEffect?: EffectSpec;
  showSource: boolean;
  beam?: TetherBeam;
  tetheredPlayerId: string | null;
  finalized: boolean;
};

type TetherBeam = {
  width: number;
  length: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  pointing?: Vec2;
};

export type PendingTether = {
  id: string;
  t: number;
  pos?: Vec2;
  fromBlackHoleOrb?: { hazardId: string; order: number };
  finalizeAfter: number;
  fireOffsets?: number[];
  despawnAfter?: number;
  tetherKind: "buff" | "debuff";
  buffName: string;
  applyEffect?: EffectSpec;
  showSource: boolean;
  beam?: TetherBeam;
};

export type LineLinkTarget = {
  mode: "closest" | "furthest";
  roles?: Role[];
  roleGroups?: Role[][];
  playerIds?: string[];
  count?: number;
};

type LineLinkVisual = {
  kind: "statue";
  width: number;
  height: number;
  depth: number;
};

export type ActiveLineLink = {
  id: string;
  name: string;
  pos: Vec2;
  spawnAt: number;
  linkUntil: number;
  resolveAt: number;
  target: LineLinkTarget;
  targetPlayerIds: string[];
  hiddenDebuff: EffectSpec;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  visual?: LineLinkVisual;
  resolved: boolean;
};

export type PendingLineLink = {
  id: string;
  t: number;
  name: string;
  pos: Vec2;
  resolveAfter: number;
  linkDuration: number;
  rng: boolean;
  link?: string;
  target: LineLinkTarget;
  hiddenDebuff: EffectSpec;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  visual?: LineLinkVisual;
};

export type ActiveChain = {
  id: string;
  name: string;
  a: string;
  b: string;
  telegraphStart: number;
  resolveAt: number;
  expireAt: number;
  breakDistance: number;
  breakAt?: number;
  breakDamage: number;
  damageType: DamageType;
  debuff: EffectSpec;
  showCastBar: boolean;
  resolved: boolean;
  broken: boolean;
  outcome?: "broken" | "damaged";
  finishedAt?: number;
};

export type PendingChain = {
  id: string;
  t: number;
  name: string;
  a: string;
  b: string;
  telegraph: number;
  breakWindow: number;
  breakDistance: number;
  breakDamage: number;
  damageType: DamageType;
  debuff: EffectSpec;
  showCastBar: boolean;
};

export type PendingForcedMarch = {
  id: string;
  t: number;
  name: string;
  pos: Vec2;
  radius: number;
  direction: Vec2;
  distance: number;
  duration: number;
  preDelay: number;
  postDelay: number;
};

export type ActiveForcedMarch = {
  id: string;
  name: string;
  pos: Vec2;
  radius: number;
  direction: Vec2;
  distance: number;
  preDelay: number;
  postDelay: number;
  relativeMove: boolean;
  armedAt: number;
  expireAt: number;
  triggered: boolean;
  triggeredAt?: number;
  capturedPlayerId?: string;
  capturedFrom?: Vec2;
  teleported: boolean;
};

export type PendingHazard = {
  id: string;
  t: number;
  name: string;
  spots: Vec2[];
  radius: number;
  duration: number;
  armingTime: number;
  applyEffect: EffectSpec;
};

export type ActiveHazard = {
  id: string;
  name: string;
  spots: Vec2[];
  radius: number;
  spawnedAt: number;
  armingTime: number;
  expireAt: number;
  applyEffect: EffectSpec;
};

export type PendingDivebomb = {
  id: string;
  t: number;
  name: string;
  from: Vec2;
  to: Vec2;
  speed: number;
  size: number;
  color: string;
  gap: number;
  damage?: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  hitInterval: number;
  teleportBoss?: string;
  hideBoss?: string;
  visual: "step" | "line";
};

export type PendingBossTeleport = {
  facing?: number;
  id: string;
  t: number;
  name: string;
  bossId: string;
  spots: Vec2[];
  rng: boolean;
};

export type PendingEffectCheck = {
  id: string;
  t: number;
  name: string;
  checks: { carriers: string; compare: [string, string]; expect: "matches" | "differs" }[];
  failureDamage: number;
  failureDamageType: DamageType;
};

export type ActiveDivebomb = Omit<PendingDivebomb, "t"> & {
  startedAt: number;
  expireAt: number;
  resolved: boolean;
  hits: Record<string, number>;
};
