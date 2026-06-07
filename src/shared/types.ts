import type { Vec2 } from "./math";

export type Role = "tank" | "healer" | "dps";

export type Control = "human" | "bot";

export type Status = "running" | "cleared" | "wiped";

export type ZoneShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "rect"; center: Vec2; width: number; height: number }
  | { kind: "polygon"; vertices: Vec2[] };

export type Arena = { zones: ZoneShape[] };

export type WaymarkId = "A" | "B" | "C" | "D" | "1" | "2" | "3" | "4";
export type Waymark = { mark: WaymarkId; pos: Vec2 };

export type Waypoint = { t: number; pos: Vec2 };

export type DamageType = "physical" | "magical" | "true";

export type EffectBehavior =
  | { kind: "none" }
  | { kind: "vuln"; damageType: "physical" | "magical"; multiplier: number }
  | { kind: "pyretic"; dps: number }
  | { kind: "freeze"; dps: number };

export type EffectSpec = {
  name: string;
  kind: "buff" | "debuff";
  duration: number;
  behavior: EffectBehavior;
  visibility?: "visible" | "invisible";
};

export type StatusEffect = {
  id: string;
  name: string;
  kind: "buff" | "debuff";
  appliedAt: number;
  duration: number;
  behavior: EffectBehavior;
  visibility?: "visible" | "invisible";
};

export type Knockback = {
  distance: number;
  height: number; // 0 = horizontal knockback; >0 = knockup arc
  origin?: Vec2;  // defaults to the AOE shape's center/origin
};

export type Player = {
  id: string;
  role: Role;
  control: Control;
  pattern?: Waypoint[];
  pos: Vec2;
  y: number;
  verticalVelocity: number;
  knockbackVelocity: Vec2; // horizontal forced-movement velocity (knockback/knockup)
  facing: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  sprintActive: number;   // seconds remaining on sprint
  sprintCooldown: number; // seconds remaining on cooldown
  antiKbActive: number;   // seconds remaining on anti-knockback buff
  antiKbCooldown: number; // seconds remaining on anti-knockback cooldown
  provokeCooldown: number; // seconds remaining on provoke cooldown (tank threat grab)
  invincible: boolean;    // when true, takes no damage and cannot die (practice mode)
  alive: boolean;
  effects: StatusEffect[];
};

export type Boss = {
  id: string;
  pos: Vec2;
  hp: number;
  maxHp: number;
  radius: number;
  facing: number;                  // radians, 0 = +Z (matches player facing convention)
  currentTarget: string | null;    // player id with top threat
  threat: Record<string, number>;  // playerId -> threat value
};

export type AOEShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "donut"; center: Vec2; inner: number; outer: number }
  | { kind: "cone"; origin: Vec2; direction: Vec2; angleDeg: number; length: number }
  | { kind: "rect"; origin: Vec2; direction: Vec2; width: number; length: number };

// Arc relative to the boss's facing (radians). A directional attack only hits players whose
// bearing from the boss is within `width/2` of `center`. center is measured clockwise from the
// facing direction: 0 = front, π = rear, π/2 = boss's right, -π/2 = left, π/4 = front-right, etc.
export type PositionalArc = { center: number; width: number };

export type ActiveMechanic = {
  id: string;
  name: string;
  shape: AOEShape;
  telegraphStart: number;
  resolveAt: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  positional?: PositionalArc;
  // While unresolved and casting, the boss holds its facing instead of tracking its target.
  lockFacing?: boolean;
  resolved: boolean;
  showCastBar: boolean;
  // When false, the ground telegraph is never drawn; the cast bar and damage still apply.
  showTelegraph: boolean;
  // When set, the circle's target (and center) is chosen at resolve time, not cast start.
  // The ground telegraph stays hidden until it resolves.
  targeting?: { mode: "closest" | "furthest"; role?: Role; origin: Vec2 };
};

export type PendingEvent = {
  id: string;
  t: number;
  name: string;
  shape: AOEShape;
  telegraph: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  positional?: PositionalArc;
  // For cone/rect: resolve origin/direction from the boss at cast start (see promotePending).
  anchor?: "boss";
  directionFrom?: "bossFacing";
  directionOffset?: number;
  lockFacing?: boolean;
  showCastBar: boolean;
  showTelegraph: boolean;
};

export type PendingTargetedEvent = {
  id: string;
  t: number;
  name: string;
  targetMode: "closest" | "furthest";
  role?: Role;
  radius: number;
  telegraph: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  showCastBar: boolean;
  showTelegraph: boolean;
};

export type TowerVisual = {
  pillar: boolean;
  countCircles: boolean;
  fallingCylinder: boolean;
  groundStyle: "standard" | "tank"; // standard: yellow inner/red outer; tank: two red
  cylinderColor?: string; // hex, e.g. "#33ccff"
  cylinderThickness?: number; // falling cylinder diameter
};

export type PendingTower = {
  id: string;
  t: number;
  name: string;
  telegraph: number;
  pos: Vec2;
  radius: number;
  requiredCount: number;
  requiredRoles?: Role[];
  wrongRoleLethal: boolean;
  failureDamage: number;
  failureDamageType: DamageType;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  visual: TowerVisual;
};

export type ActiveTower = {
  id: string;
  name: string;
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
  knockback?: Knockback;
  visual: TowerVisual;
  resolved: boolean;
  soakerCount: number;            // live valid-soaker count, drives count-circle fill
  outcome?: "success" | "failure"; // set at resolve, drives the post-resolve flash
};


export type PendingInverse = {
  id: string;
  t: number;
  name: string;
  telegraph: number;
  shownShapes: AOEShape[];         // telegraph shapes that ARE drawn
  hiddenShapes: AOEShape[];        // not drawn; lethal when inverted ("?")
  ringColor?: string;              // hex colour of this mechanic's boss ring
  ringHeight?: number;             // vertical height of this mechanic's boss ring
  rng: boolean;                    // randomize the inversion at cast start
  questionMark?: boolean;          // authored override of the inversion state
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
  ringColor?: string;              // hex colour of this mechanic's boss ring
  ringHeight?: number;             // vertical height of this mechanic's boss ring
  inverted: boolean;               // true => "?" telegraph: hiddenShapes are lethal
  telegraphStart: number;
  resolveAt: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  showCastBar: boolean;
  resolved: boolean;
};

export type PendingGroupEvent = {
  id: string;          // event id, used as the linking key
  t: number;
  name: string;
  groups: string[][];   // candidate groups of player ids; one member is marked
  rng: boolean;         // pick a random group (else groups[0])
  link?: string;        // take the complementary group of the referenced group event
  telegraph: number;
  radius: number;       // stack circle radius around the marked player
  requiredCount: number; // soakers needed inside the radius; fewer -> stack fails (full damage each)
  damage: number;       // total damage, split evenly among soakers on success
  damageType: DamageType;
  applyEffect?: EffectSpec;
  showCastBar: boolean;
};

export type ActiveGroupMechanic = {
  id: string;
  name: string;
  telegraphStart: number;
  resolveAt: number;
  markedPlayerId: string; // random member of the chosen group; carries the stack marker
  radius: number;         // stack circle radius around the marked player
  requiredCount: number;  // soakers needed inside the radius; fewer -> stack fails (full damage each)
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  resolved: boolean;
  showCastBar: boolean;
  outcome?: "success" | "failure"; // set at resolve, drives the post-resolve flash
};

export type LogEntry = {
  t: number;
  mechanic: string;
  playerId: string;
  event: "hit" | "fell" | "cleared";
};

export type TetherSource = {
  id: string;
  pos: Vec2;
  spawnAt: number;
  finalizeAt: number;
  tetherKind: "buff" | "debuff";
  buffName: string;
  behavior: EffectBehavior;
  effectDuration: number;
  tetheredPlayerId: string | null;
  finalized: boolean;
};

export type PendingTether = {
  id: string;
  t: number;
  pos: Vec2;
  finalizeAfter: number;
  tetherKind: "buff" | "debuff";
  buffName: string;
  behavior: EffectBehavior;
  effectDuration: number;
};

export type LineLinkTarget = {
  mode: "closest" | "furthest";
  roles?: Role[];
  playerIds?: string[];
  count?: number;
};

export type LineLinkVisual = {
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
  hiddenDebuffName: string;
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
  target: LineLinkTarget;
  hiddenDebuffName: string;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  visual?: LineLinkVisual;
};

export type ActiveChain = {
  id: string;
  name: string;
  a: string;             // chained player ids
  b: string;
  telegraphStart: number;
  resolveAt: number;     // cast end: debuff applied + line connects
  expireAt: number;      // resolveAt + breakWindow: burst if still chained
  breakDistance: number; // extra separation (beyond the starting distance) needed to break
  breakAt?: number;      // absolute threshold = starting distance + breakDistance, set at resolve
  breakDamage: number;
  damageType: DamageType;
  debuffName: string;
  showCastBar: boolean;
  resolved: boolean;     // cast finished, debuff applied, line shown
  broken: boolean;       // pair separated in time (success)
  outcome?: "broken" | "damaged"; // set at end, drives the post-resolve flash
  finishedAt?: number;   // time the outcome was decided, for the render linger
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
  debuffName: string;
  showCastBar: boolean;
};

export type Intent = {
  move: Vec2;
  jump?: boolean;
  sprint?: boolean;
  antiKnockback?: boolean;
  provoke?: boolean;
  toggleInvincibility?: boolean;
};

export type Intents = Record<string, Intent>;

export type World = {
  time: number;
  rngState: number;                     // seeded PRNG state (shared/rng.ts), advanced each pull
  groupChoices: Record<string, number>; // group event id -> chosen group index (for linking)
  status: Status;
  hasMechanics: boolean;
  arena: Arena;
  waymarks: Waymark[];
  players: Player[];
  boss: Boss;
  active: ActiveMechanic[];
  pending: PendingEvent[];
  log: LogEntry[];
  duration: number;
  tetherSources: TetherSource[];
  pendingTethers: PendingTether[];
  lineLinks: ActiveLineLink[];
  pendingLineLinks: PendingLineLink[];
  pendingTargeted: PendingTargetedEvent[];
  towers: ActiveTower[];
  pendingTowers: PendingTower[];
  chains: ActiveChain[];
  pendingChains: PendingChain[];
  groupMechanics: ActiveGroupMechanic[];
  pendingGroups: PendingGroupEvent[];
  inversions: ActiveInverse[];
  pendingInversions: PendingInverse[];
};
