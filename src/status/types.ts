import type { Vec2 } from "@shared/math";
import type { AOEShape } from "@effects";

export type DamageType = "physical" | "magical" | "true";
export type CrystalElement = "wind" | "fire" | "water" | "earth";
export type StatusClass = "buff" | "debuff";
export type CircleOrDonut = "circle" | "donut";

export type BurstFollowUp = {
  mode: "closest" | "furthest";
  count: number;
  originCrystal?: CrystalElement;
  shape: CircleOrDonut;
  radius: number;
  inner?: number;
  damage: number;
  damageType: DamageType;
  knockbackDistance?: number;
};

export type StatusBehavior =
  | { kind: "none" }
  | { kind: "vuln"; damageType: "physical" | "magical"; multiplier: number }
  | { kind: "mitigation"; damageType?: DamageType; multiplier: number }
  | { kind: "dot"; dps: number; condition: "always" | "moving" | "idle" }
  | { kind: "confusion"; damage: number; damageType: DamageType; radius: number }
  | { kind: "sleep" }
  | { kind: "burstSpread"; radius: number; damage: number; damageType: DamageType; knockbackDistance: number; selfShape?: CircleOrDonut; selfInner?: number; followUp?: BurstFollowUp }
  | { kind: "effectBurst"; shape: CircleOrDonut; radius: number; innerRadius?: number; damage: number; damageType: DamageType }
  | { kind: "twister"; delay: number; shownShape: CircleOrDonut; hiddenShape: CircleOrDonut; radius: number; innerRadius?: number; rng?: boolean; questionMark?: boolean; damage: number; damageType: DamageType }
  | { kind: "carrierGaze"; cone: { angleDeg: number; length: number }; damage: number; damageType: DamageType }
  | { kind: "reverseCarrierGaze"; coneHalfAngle?: number; damage: number; damageType: DamageType }
  | { kind: "pairedSpreadStack"; key: string; role: "stack" | "spread"; spread: { radius: number; damage: number }; stack: { radius: number; requiredCount: number; damage: number }; damageType: DamageType }
  | { kind: "effectCheck"; compare: [string, string]; expect: "matches" | "differs"; failureDamage: number; failureDamageType: DamageType }
  | { kind: "plant"; direction: [number, number]; distance: number; radius: number; armDelay: number; duration: number; tpDelay: number }
  | { kind: "directionalKnockback"; requiredFacing: "away" | "toward"; distance: number; doubledDistance: number }
  | { kind: "escalating"; escalationKey: string; escalateTo?: string; escalateDamage?: number; escalateDamageType?: DamageType }
  | { kind: "alternating"; alternationKey: string; repeatDamage?: number; repeatDamageType?: DamageType; repeatApply?: string }
  | { kind: "expiryDamage"; expiryDamage: number; expiryDamageType: DamageType; surviveLethal?: boolean; cleanseAtFullHp?: boolean }
  | { kind: "elementCleanse"; elements: Record<string, string>; expiryDamage: number; expiryDamageType: DamageType }
  | { kind: "elementVuln"; mechanic: string; multiplier: number }
  | { kind: "motionCheck"; required: "move" | "still"; window: number; failureDamage: number; failureDamageType: DamageType; failureKnockupHeight: number }
  | { kind: "movementSpeed"; multiplier: number }
  | { kind: "knockbackImmunity" };

export type StatusBehaviorKind = StatusBehavior["kind"];
export type BehaviorOf<K extends StatusBehaviorKind> = Extract<StatusBehavior, { kind: K }>;

export type StatusRing = { color: string; icon: string };
export type StatusCountdown = { delay: number; slices: number };

export type StatusTemplate = {
  name: string;
  kind: StatusClass;
  avoidable?: boolean;
  duration: number;
  stacks?: number;
  behavior: StatusBehavior;
  visibility?: "visible" | "invisible";
  priority?: boolean;
  group?: string;
  showTimer?: boolean;
  icon?: string;
  marker?: string;
  markerIcon?: string;
  markerIconScale?: number;
  ring?: StatusRing;
  countdown?: StatusCountdown;
};

export type StatusSpec = StatusTemplate & { ref: string };

export type StatusRuntime = {
  lockedTargetId?: string;
  plantSlot?: number;
  limitCutNumber?: number;
  cleansedElements?: string[];
};

export type StatusInstance = StatusSpec & StatusRuntime & {
  id: string;
  appliedAt: number;
};

export type StatusOverrides = Partial<Omit<StatusTemplate, "behavior">> & {
  behavior?: Partial<StatusBehavior>;
};

export type StatusRef = StatusOverrides & { ref: string };

export type StatusBundle = { effects: StatusSpec[]; order: "listed" | "shuffle" | "shuffleBalanced" };

export type StatusIcon = { glyph?: string; src?: string; rotate?: number };

export type StatusSource = { key: string; name: string; avoidable: boolean };

export type Knockback = {
  distance: number;
  height: number;
  origin?: Vec2;
};

export type StatusActor = {
  id: string;
  pos: Vec2;
  facing: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  invincible: boolean;
  lastMotionAt?: number;
  effects: StatusInstance[];
};

export type ApplyEnv<A extends StatusActor = StatusActor> = {
  readonly time: number;
  readonly actors: readonly A[];
  damage(target: A, amount: number, damageType: DamageType, source: StatusSource): void;
};

export type ShapeKnockback = { distance: number; origin: Vec2; exemptId?: string };

export type PendingFollowUp = { id: string; t: number; name: string; avoidable?: boolean; originCrystal: CrystalElement; followUp: BurstFollowUp };
export type PendingTwister = { id: string; t: number; name: string; avoidable?: boolean; shape: AOEShape; damage: number; damageType: DamageType };
export type PlacedTrap = { id: string; name: string; pos: Vec2; radius: number; direction: Vec2; distance: number; preDelay: number; armedAt: number; expireAt: number };

export type StatusServices<A extends StatusActor = StatusActor> = ApplyEnv<A> & {
  readonly previousTime: number;
  log(mechanic: string, actorId: string, event: "hit" | "cleared"): void;
  recordDeath(actor: A, source: StatusSource): void;
  randFloat(): number;
  hitShape(shape: AOEShape, damage: number, damageType: DamageType, source: StatusSource, knockback?: ShapeKnockback): void;
  resolveStack(shape: AOEShape, stack: { damage: number; requiredCount: number }, damageType: DamageType, source: StatusSource): boolean;
  selectTargets(origin: Vec2, mode: "closest" | "furthest", count: number, excludeId?: string): A[];
  showAoe(id: string, name: string, shape: AOEShape): void;
  isLookingAt(actor: A, target: Vec2, halfAngle: number): boolean;
  launch(actor: A, height: number): number;
  scheduleFollowUp(pending: PendingFollowUp): void;
  scheduleTwister(pending: PendingTwister): void;
  placeTrap(trap: PlacedTrap): void;
};
