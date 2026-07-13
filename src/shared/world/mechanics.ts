import type { Vec2 } from "../math";
import type { FloorAoe } from "../floorAoe";
import type {
  AOEShape, BossRelativeCenter, CrystalElement, DamageType, FlashBeforeResolve,
  PositionalArc, Role, TelegraphMode,
} from "./foundation";
import type { EffectBehavior, EffectBundle, EffectSpec, Knockback, Reassign } from "./effects";

export type ActiveMechanic = {
  id: string;
  name: string;
  // Optional bot-solver labels/group carried from the authored event (see GenericSolverRule).
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
  // While unresolved and casting, the boss holds its facing instead of tracking its target.
  lockFacing?: boolean;
  // While unresolved and casting, the boss does not move toward its target.
  bossStationary?: boolean;
  // Stored-cleave (deferred) support: a `deferred` mechanic shows its own cast bar, then sits dormant
  // (no telegraph, unresolved) until a linked `bait` arms it. `armed` flips it back to a normal
  // resolving cone/rect; the anchor fields let its geometry be recomputed from the boss's locked
  // facing at arm time (see promotePending + resolveAoe).
  deferred?: boolean;
  armed?: boolean;
  telegraphDuration?: number;
  requireFullHp?: boolean;
  anchor?: "boss";
  directionFrom?: "bossFacing";
  directionOffset?: number;
  resolved: boolean;
  showCastBar: boolean;
  // When false, the ground telegraph is never drawn; the cast bar and damage still apply.
  showTelegraph: boolean;
  // "resolve" hides the marker while casting, then uses the normal resolved flash.
  telegraphMode?: TelegraphMode;
  // The render-facing wrapper for this mechanic's ground telegraph. Absent when showTelegraph is
  // false. Reassigned (not mutated) whenever `shape` changes, e.g. targeting resolution.
  floorAoe?: FloorAoe;
  // When set, the circle's target (and center) is chosen at resolve time, not cast start.
  // The ground telegraph stays hidden until it resolves. "aggro" picks the boss's current
  // threat target (the player holding aggro).
  targeting?: { mode: "closest" | "furthest" | "aggro"; role?: Role; origin: Vec2; count?: number };
  // Optional post-resolve visual linger override. Used by instant resolved visuals that would
  // otherwise only survive one simulation tick.
  lingerFor?: number;
  // Render-only: flash the footprint in this color for the final `lead` seconds before the hit.
  flashBeforeResolve?: FlashBeforeResolve;
  // Ground telegraph color (hex). Kept alongside showTelegraph/telegraphMode/flashBeforeResolve so a
  // deferred cleave can rebuild floorAoe when a bait arms it (see buildFloorAoe).
  color?: string;
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
  // For cone/rect: resolve origin/direction from the boss at cast start (see promotePending).
  anchor?: "boss";
  directionFrom?: "bossFacing";
  directionOffset?: number;
  aimAtPlayer?: string;
  lockFacing?: boolean;
  bossStationary?: boolean;
  // When true, this cleave is stored: it does not resolve at its own cast end; a linked bait arms it.
  deferred?: boolean;
  requireFullHp?: boolean;
  showCastBar: boolean;
  showTelegraph: boolean;
  telegraphMode: TelegraphMode;
  bossRelativeCenter?: BossRelativeCenter;
  flashBeforeResolve?: FlashBeforeResolve;
  // Ground telegraph color (hex). Defaults to the standard danger red when omitted.
  color?: string;
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


// A bait selects a player at cast START (random/closest/furthest) and turns + locks the boss toward
// them for the cast. It deals no damage itself; `link` is the id of a deferred stored cleave that the
// bait aims (from the locked facing) and detonates at cast END.
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

// An effect-burst spawns an AOE circle on every player carrying a named effect (e.g. a burst
// around each sleeping player). At cast start it drops one normal AOE per carrier.
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
  groundStyle: "standard" | "tank"; // standard: yellow inner/red outer; tank: two red
  cylinderColor?: string; // hex, e.g. "#33ccff"
  cylinderThickness?: number; // falling object diameter/width
  fallingObjectAlpha?: number; // falling object opacity
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
  shownShapesB?: AOEShape[];       // variant-b telegraph shapes (used when variantRng rolls b)
  hiddenShapesB?: AOEShape[];      // variant-b hidden shapes
  variantRng?: boolean;            // randomize a/b orientation at cast start
  ringColor?: string;              // hex colour of this mechanic's boss ring
  ringHeight?: number;             // vertical height of this mechanic's boss ring
  telegraphAlpha?: number;          // optional fixed alpha for shown telegraph footprints
  color?: string;                  // shownShapes fill color; defaults to ringColor, else blue/red by inverted state
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
  telegraphAlpha?: number;          // optional fixed alpha for shown telegraph footprints
  // Render-facing wrapper, one per shownShapes entry (hiddenShapes are never drawn).
  floorAoes?: FloorAoe[];
  inverted: boolean;               // true => "?" telegraph: hiddenShapes are lethal
  variantB: boolean;               // true => the b orientation was rolled (for bot solvers)
  telegraphStart: number;
  resolveAt: number;
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  showCastBar: boolean;
  resolved: boolean;
};

// A "?" mechanic that flips between spread (per-player AOEs) and stack (shared soak).
type SpreadStackMode = "spread" | "stack";
type SpreadStackShown = SpreadStackMode | "random"; // authored; "random" resolves to a concrete mode at cast start

type SpreadConfig = { radius: number; damage: number };
type StackConfig = { groups: string[][]; radius: number; requiredCount: number; damage: number };

export type PendingSpreadStack = {
  id: string;
  t: number;
  name: string;
  telegraph: number;
  shown: SpreadStackShown;         // marker drawn during the cast ("random" = seeded per pull)
  rng: boolean;                    // seeded 50/50 flip at cast start
  questionMark?: boolean;          // authored override of the flip state
  damageType: DamageType;
  spread: SpreadConfig;
  stack: StackConfig;
  stackCarriers?: string;
  spreadCarriers?: string;
  ringColor?: string;              // hex colour of this mechanic's boss ring
  ringHeight?: number;             // vertical height of this mechanic's boss ring
  showCastBar: boolean;
};

export type ActiveSpreadStack = {
  id: string;
  name: string;
  telegraphStart: number;
  resolveAt: number;
  shown: SpreadStackMode;          // what the markers display
  inverted: boolean;               // true => "?": actual mode is the opposite of `shown`
  markedPlayerIds: string[];       // stack-mode marked member per group (rolled even when shown=spread)
  spread: SpreadConfig;
  stack: StackConfig;
  spreadPlayerIds?: string[];
  damageType: DamageType;
  ringColor?: string;
  ringHeight?: number;
  showCastBar: boolean;
  resolved: boolean;
  outcome?: "success" | "failure"; // set at resolve (stack mode), drives the post-resolve flash
};

type GazeVisual = { width: number; height: number; depth: number };
type CarrierCone = { angleDeg: number; length: number };

export type PendingGaze = {
  id: string;
  t: number;
  name: string;
  telegraph: number;
  pos: Vec2;                       // position of the eye/source
  carriers?: string;
  carrierCone?: CarrierCone;
  reverse: boolean;               // false: hit if looking at it; true ("?" eye): hit if NOT looking
  rng: boolean;                   // randomize the reverse state at cast start
  coneHalfAngle: number;          // half-angle (radians) counted as "looking at" it
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  showCastBar: boolean;
  visual?: GazeVisual;
  color?: string;                  // carrier cone fill color; defaults to orange/blue by reverse state
};

export type ActiveGaze = {
  id: string;
  name: string;
  pos: Vec2;
  excludePlayerId?: string;
  carrierId?: string;
  direction?: Vec2;
  carrierCone?: CarrierCone;
  reverse: boolean;               // resolved at cast start; drives the eye vs "?" eye icon
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
  // Render-facing wrapper for the carrier cone footprint. Absent when there's no carrier cone.
  floorAoe?: FloorAoe;
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
  showMarker: boolean;
  showTelegraph: boolean;
  color?: string;       // stack circle color; defaults to the standard "stack here" blue
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

// Assigns each player a unique numbered marker (1–8) by seeded Fisher-Yates shuffle.
export type PendingLimitCut = {
  id: string;
  t: number;
  name: string;
  effect: EffectSpec;
  players?: string[];
  role?: Role;
  // Bot-solver placement basis: relative-north (opposite Kefka's first divebomb) + the players'
  // rotation direction (opposite Kefka's dash). Computed from the event's rotation config at build.
  rotation: { north: Vec2; clockwise: boolean };
};

// A fired limit cut, live for its effect duration so bot-solver rules can gate on it via
// when.mechanic and read its placement basis. `north`/`clockwise` carry the rotation from the event.
export type ActiveLimitCut = {
  id: string;
  appliedAt: number;
  duration: number;
  north: Vec2;
  clockwise: boolean;
};

// A standalone "drop this effect on players now" event. Targeting: `players` ids if given, else
// `role` filter, else everyone alive; `count` caps how many (random when `rng`, else roster order).
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

export type PendingBurstSpreadFollowUp = {
  id: string;
  t: number;
  name: string;
  originCrystal: CrystalElement;
  followUp: NonNullable<Extract<EffectBehavior, { kind: "burstSpread" }>["followUp"]>;
};

export type PendingTwister = {
  id: string;
  t: number;
  name: string;
  shape: AOEShape;
  damage: number;
  damageType: DamageType;
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
  showMarker: boolean;
  showTelegraph: boolean;
  color?: string;
  // Render-facing wrapper for the stack circle. Absent when showTelegraph is false. Rebuilt every
  // tick with the marked player's live position (see resolveGroups) rather than reassigned once.
  floorAoe?: FloorAoe;
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
  // Baked position for a plain tether_source. Black-hole lasers leave this undefined and instead
  // carry fromBlackHoleOrb: their origin is resolved from the locked clockwise order at promote.
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
  rng: boolean;
  link?: string;
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

// A ground-placed arrow trap. The first living player to enter the zone is captured: frozen for
// `preDelay`, teleported `distance` units along `direction`, then frozen for `postDelay` before
// being released. The trap is consumed by that first entrant.
export type PendingForcedMarch = {
  id: string;
  t: number;
  name: string;
  pos: Vec2;
  radius: number;     // trigger zone radius
  direction: Vec2;    // arrow / teleport direction
  distance: number;   // teleport distance along direction
  duration: number;   // how long the trap stays armed before expiring
  preDelay: number;   // seconds frozen on the trap before the teleport
  postDelay: number;  // seconds frozen at the destination after the teleport
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
  relativeMove: boolean;       // true: teleport `distance` from the captured player's spot (plant);
                               // false (forced_march): destination is anchored to the trap center
  armedAt: number;
  expireAt: number;
  triggered: boolean;
  triggeredAt?: number;        // time the entrant stepped on it (start of preDelay windup)
  capturedPlayerId?: string;   // the player being marched
  capturedFrom?: Vec2;         // where the captured player was grabbed (teleport anchor when relativeMove)
  teleported: boolean;         // whether the teleport (after preDelay) has happened yet
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
  teleportBoss?: string; // on cast start, move this boss to `from` (facing `to`) and unhide it
  hideBoss?: string;     // on cast start, hide this boss's model
  visual: "step" | "line"; // render style: single stepping sphere, or a sphere-per-slot exploding line
};

export type PendingBossTeleport = {
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
