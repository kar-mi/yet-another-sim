import type { Vec2 } from "./math";

export type Role = "tank" | "healer" | "dps";

export type Control = "human" | "bot";

export type Status = "running" | "cleared" | "wiped";

export type ZoneShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "rect"; center: Vec2; width: number; height: number }
  | { kind: "polygon"; vertices: Vec2[] };

export type FloorPlan = "squares" | "dmu-p1" | "dmu-p2";

export type Arena = { zones: ZoneShape[]; floorPlan: FloorPlan };

export type WaymarkId = "A" | "B" | "C" | "D" | "1" | "2" | "3" | "4";
export type Waymark = { mark: WaymarkId; pos: Vec2 };

export type CrystalElement = "wind" | "fire" | "water";
export type Crystal = { id: string; element: CrystalElement; pos: Vec2; spawnAt: number };

export type Waypoint = { t: number; pos: Vec2 };

// One ordered, data-driven bot-solver rule (see docs/authoring-bot-patterns.md "Generic solver").
// A rule is active during a matched mechanic's telegraph->resolve window (and/or while a named
// debuff is active), optionally clamped by startAt/endAt. When active it sends each matching bot
// to spots[its id] ?? spot. Conditions in `when` are ANDed.
export type GenericSolverRule = {
  when: {
    static?: true; // explicit always-active rule; normally used as the final fallback
    // segment-prefix match on a resolved mechanic id (e.g. "lightning-1" matches "lightning-1.inverted.b")
    // OR an exact match against one of the resolved mechanic's labels. An array requires every listed
    // mechanic to be active at once (e.g. a spread_stack mode AND a concurrent inverse orientation).
    mechanic?: string | string[];
    role?: Role;
    debuff?: string | string[];   // active effect name(s) on the bot; an array requires all of them
    partyDebuff?: string | string[]; // active effect name(s) anywhere in the party; an array requires all of them
    partnerDebuff?: string | string[]; // active effect name(s) on the bot's partner (world.partners)
    // Compares the bot's group (world.playerGroups) to the group of the first live matched mechanic.
    // true => equal (the bot soaks this wave); false => the mechanic has a group and the bot's differs.
    // Requires when.mechanic.
    soaks?: boolean;
    plant?: string;    // the bot's assigned plant combo key (e.g. "right right"); active while it carries a plant debuff
    plantSlot?: number; // restrict to a specific plant slot (short/long); omit to match either
    endingFacing?: { event: string; offset: number }; // matches world.endingOffsets[event]
  };
  startAt?: number;
  endAt?: number;
  // Optional rotated frame for spot coordinates. "matched": north = normalize(Σ positions) of the
  // live matched mechanics (e.g. a tower pair's bisector). Otherwise a list of references whose
  // positions are summed and normalized: a positioned event id (tower), { crystal } (a resolved
  // elemental crystal), or { boss } (a boss's facing direction or its position). Mixing kinds is
  // allowed. Authored framed spots use {r, z} or polar {dist, angleDeg}; load-time conversion stores
  // the lateral frame coordinate r in Vec2.x for the frame transform.
  // A rule whose frame can't be computed yields no spot (falls through).
  frame?: "matched" | FrameRef[];
  // Optional origin for framed spots. Defaults to arena center; boss origin makes spots local to
  // that boss position while still using the rule's frame for rotation.
  origin?: { boss: string };
  // For a mixed boss-facing frame, flip the lateral axis when the other references are on the
  // boss's left. This lets one authored spot mirror across east/west mechanic configurations.
  mirrorLateral?: boolean;
  spots?: Record<string, Vec2>; // per-player spot; wins over spot
  spot?: Vec2;                   // one spot for every matching bot
  // Limit Cut placement. Requires when.mechanic naming a fired limit cut (World.limitCuts): the
  // matched mechanic supplies the rotation basis. `spots[n-1]` is the placement for limit-cut number
  // n, authored relative to relative-north (lateral r in Vec2.x, like a frame spot); the solver
  // rotates it by that limit cut's north and mirrors it by the players' rotation direction. Returns
  // absolute coords, so this rule must not also set frame/spot/spots; bots without a number fall through.
  limitCutSpread?: { spots: Vec2[] };
};

// A single positioned reference summed into a frame's north vector: a positioned event id, a
// resolved elemental crystal, or a boss (its facing direction or its position).
export type FrameRef =
  | string
  | { crystal: CrystalElement }
  | { boss: { id?: string; from: "facing" | "position" } };

// When any mechanic matching `mechanic` (id-prefix or label, like GenericSolverRule.when.mechanic)
// resolves, bots hold their current position for `duration` seconds before re-solving.
export type SolverHold = {
  mechanic: string | string[];
  duration: number;
};

export type BotSolvers = {
  generic?: GenericSolverRule[];
  holds?: SolverHold[];
};

export type DamageType = "physical" | "magical" | "true";
export type TelegraphMode = "cast" | "resolve";

// Render-only: during the final `lead` seconds before resolve, flash the AoE footprint
// in `color` (hex; defaults to light blue) as a just-in-time tell. Drawn even when
// showTelegraph is false. Does not affect simulation timing or damage.
export type FlashBeforeResolve = { lead: number; color?: string };

export type EffectBehavior =
  | { kind: "none" }
  | { kind: "vuln"; damageType: "physical" | "magical"; multiplier: number }
  | { kind: "mitigation"; damageType?: DamageType; multiplier: number }
  // Generic damage-over-time. `condition` gates when a tick deals damage: "always" every tick,
  // "moving" only when the player acted this tick (old "pyretic"), "idle" only when they didn't
  // (old "freeze").
  | { kind: "dot"; dps: number; condition: "always" | "moving" | "idle" }
  // Forces the player to walk toward a locked target; on contact the target takes
  // friendly-fire damage and the debuff ends. Target is locked when the debuff lands.
  | { kind: "confusion"; damage: number; damageType: DamageType; radius: number }
  // Disables all input for the effect's duration (not broken by damage).
  | { kind: "sleep" }
  // On expiry, bursts at the carrier, then can spread follow-up AOEs to nearby/far players.
  | { kind: "burstSpread"; radius: number; damage: number; damageType: DamageType; knockbackDistance: number; selfShape?: "circle" | "donut"; selfInner?: number; followUp?: { mode: "closest" | "furthest"; count: number; originCrystal?: CrystalElement; shape: "circle" | "donut"; radius: number; inner?: number; damage: number; damageType: DamageType; knockbackDistance?: number } }
  // Tele-Trouncing "plant": the HUD shows an arrow along `direction` ([x, z]). When the debuff
  // expires it places a teleport trap (forced march) at the player's spot — inert for `armDelay`
  // seconds so the placer can step off, then triggers on contact: the entrant is frozen for
  // `tpDelay` seconds, then instantly teleported `distance` along `direction`. An untriggered trap
  // expires `duration` seconds after it arms.
  | { kind: "plant"; direction: [number, number]; distance: number; radius: number; armDelay: number; duration: number; tpDelay: number }
  | { kind: "directionalKnockback"; requiredFacing: "away" | "toward"; distance: number; doubledDistance: number }
  // Reapplying any active effect with the same key removes it, then upgrades or deals terminal damage.
  | { kind: "escalating"; escalationKey: string; escalateTo?: string; escalateDamage?: number; escalateDamageType?: DamageType }
  // Would-be-lethal hit leaves carrier at 1 HP and cleanses the debuff. Uncleansed expiry is lethal.
  | { kind: "primordialCrust"; expiryDamage: number; expiryDamageType: DamageType }
  // Cleansed by healing carrier to full HP. Uncleansed expiry is lethal.
  | { kind: "accretion"; expiryDamage: number; expiryDamageType: DamageType }
  // Generic assignment/priority marker (e.g. First/Second/Third in Line, Alpha/Beta). Pure HUD marker; deals expiryDamage on expiry. No cleanse path.
  | { kind: "assignment"; expiryDamage: number; expiryDamageType: DamageType };

export type EffectSpec = {
  name: string;
  kind: "buff" | "debuff";
  duration: number;
  behavior: EffectBehavior;
  visibility?: "visible" | "invisible";
  // Optional HUD icon: a bare filename served from /static/debuffs/. Falls back to a behavior glyph.
  icon?: string;
  // Optional short marker rendered above the player while the effect is active.
  marker?: string;
  // Optional above-head marker image: a bare filename served from /static/head_markers/.
  markerIcon?: string;
  markerIconScale?: number; // per-icon size multiplier (default 4)
};

export type EffectBundle = {
  effects: EffectSpec[];
  order: "listed" | "shuffle" | "shuffleBalanced";
};

export type StatusEffect = {
  id: string;
  name: string;
  kind: "buff" | "debuff";
  appliedAt: number;
  duration: number;
  behavior: EffectBehavior;
  visibility?: "visible" | "invisible";
  // Optional HUD icon: a bare filename served from /static/effects/. Falls back to a behavior glyph.
  icon?: string;
  // Optional short marker rendered above the player while the effect is active.
  marker?: string;
  // Optional above-head marker image: a bare filename served from /static/head_markers/.
  markerIcon?: string;
  markerIconScale?: number; // per-icon size multiplier (default 4)
  // Set when a confusion debuff lands: the player it forces this player to walk toward.
  lockedTargetId?: string;
  // Plant slot index from the assigned combo. Used by bot solvers to place each arrow separately.
  plantSlot?: number;
  // Limit Cut number (1–8) assigned by a limit_cut event. Used by bot solvers to place each
  // numbered player around the inter-inter-cardinal ring.
  limitCutNumber?: number;
};

// Generic "reassign" mechanic: distribute named charge debuffs across players, then re-balance to
// target counts after a labelled mechanic resolves. `charges` maps each kind to its effect + marker
// spec; `initial: "plan"` opens by applying world.initialCharges; `onResolve` keys a trigger label
// (e.g. a tower's label) to the per-kind target counts the re-balance should reach, dealt to that
// mechanic's just-resolved players in roster order.
export type ReassignCharge = {
  kind: string;
  effect: EffectSpec;
  marker?: EffectSpec;
};

export type Reassign = {
  id: string;
  t: number;
  name: string;
  charges: ReassignCharge[];
  initial?: "plan";
  onResolve?: Record<string, Record<string, number>>;
  initialDealt: boolean; // runtime: set once the opener (initial) deal has fired
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
  botWaypointResumeAfter?: number; // forced movement ignores authored waypoints at or before this time
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
  targetBossId: string;   // which boss this player is focused on (used by provoke + target ring)
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
  ringScale: number;               // floor-ring visual scale (BossRingLayer)
  ringColor: string;               // floor-ring hex color
  model: string;                   // glb filename stem under /static/model/ (without extension)
  modelScale: number;              // multiplier applied on top of the base model scale
  targetable: boolean;
  hidden: boolean;                 // when true, the model is not drawn (e.g. boss ducked under the map)
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
  // When set, the circle's target (and center) is chosen at resolve time, not cast start.
  // The ground telegraph stays hidden until it resolves. "aggro" picks the boss's current
  // threat target (the player holding aggro).
  targeting?: { mode: "closest" | "furthest" | "aggro"; role?: Role; origin: Vec2; count?: number };
  // Optional post-resolve visual linger override. Used by instant resolved visuals that would
  // otherwise only survive one simulation tick.
  lingerFor?: number;
  // Render-only: flash the footprint in this color for the final `lead` seconds before the hit.
  flashBeforeResolve?: FlashBeforeResolve;
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
  lockFacing?: boolean;
  bossStationary?: boolean;
  // When true, this cleave is stored: it does not resolve at its own cast end; a linked bait arms it.
  deferred?: boolean;
  requireFullHp?: boolean;
  showCastBar: boolean;
  showTelegraph: boolean;
  telegraphMode: TelegraphMode;
  flashBeforeResolve?: FlashBeforeResolve;
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
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  showCastBar: boolean;
  showTelegraph: boolean;
  telegraphMode: TelegraphMode;
};

export type EffectResolverAction =
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

export type TowerVisual = {
  pillar: boolean;
  countCircles: boolean;
  fallingCylinder: boolean;
  fallingObject?: "cylinder" | "sphere" | "box";
  groundStyle: "standard" | "tank"; // standard: yellow inner/red outer; tank: two red
  cylinderColor?: string; // hex, e.g. "#33ccff"
  cylinderThickness?: number; // falling object diameter/width
  fallingObjectAlpha?: number; // falling object opacity
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
export type SpreadStackMode = "spread" | "stack";
export type SpreadStackShown = SpreadStackMode | "random"; // authored; "random" resolves to a concrete mode at cast start

export type SpreadConfig = { radius: number; damage: number };
export type StackConfig = { groups: string[][]; radius: number; requiredCount: number; damage: number };

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
  damageType: DamageType;
  ringColor?: string;
  ringHeight?: number;
  showCastBar: boolean;
  resolved: boolean;
  outcome?: "success" | "failure"; // set at resolve (stack mode), drives the post-resolve flash
};

export type GazeVisual = { width: number; height: number; depth: number };

export type PendingGaze = {
  id: string;
  t: number;
  name: string;
  telegraph: number;
  pos: Vec2;                       // position of the eye/source
  reverse: boolean;               // false: hit if looking at it; true ("?" eye): hit if NOT looking
  rng: boolean;                   // randomize the reverse state at cast start
  coneHalfAngle: number;          // half-angle (radians) counted as "looking at" it
  damage: number;
  damageType: DamageType;
  applyEffect?: EffectSpec;
  knockback?: Knockback;
  showCastBar: boolean;
  visual?: GazeVisual;
};

export type ActiveGaze = {
  id: string;
  name: string;
  pos: Vec2;
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
  icon?: string;
  applyTetherEffect: boolean;
  beam?: TetherBeam;
  tetheredPlayerId: string | null;
  finalized: boolean;
};

export type TetherBeam = {
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
  pos: Vec2;
  finalizeAfter: number;
  tetherKind: "buff" | "debuff";
  buffName: string;
  behavior: EffectBehavior;
  effectDuration: number;
  icon?: string;
  applyTetherEffect: boolean;
  beam?: TetherBeam;
};

export type LineLinkTarget = {
  mode: "closest" | "furthest";
  roles?: Role[];
  roleGroups?: Role[][];
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

export type ActiveDivebomb = Omit<PendingDivebomb, "t"> & {
  startedAt: number;
  expireAt: number;
  resolved: boolean;
  hits: Record<string, number>;
};

export type Intent = {
  move: Vec2;
  facing?: number;             // absolute facing in radians (atan2(x, z)); when set, overrides movement-derived facing
  jump?: boolean;
  sprint?: boolean;
  antiKnockback?: boolean;
  provoke?: boolean;
  cycleTarget?: boolean;
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
  crystals: Crystal[];
  players: Player[];
  boss: Boss;
  bosses: Boss[];
  active: ActiveMechanic[];
  pending: PendingEvent[];
  log: LogEntry[];
  duration: number;
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
  divebombs: ActiveDivebomb[];
  pendingForcedMarches: PendingForcedMarch[];
  pendingDivebombs: PendingDivebomb[];
  pendingEffectBursts: PendingEffectBurst[];
  effectResolvers: Record<string, EffectResolver>;
  pendingHeals: PendingHeal[];
  pendingSetHps: PendingSetHp[];
  reassigns: Reassign[];
  pendingEffectSelects: PendingEffectSelect[];
  pendingApplyEffects: PendingApplyEffect[];
  pendingBurstSpreadFollowUps: PendingBurstSpreadFollowUp[];
  pendingLimitCuts: PendingLimitCut[];
  // Fired limit cuts, live for their effect duration (bot-solver when.mechanic gates on these).
  limitCuts: ActiveLimitCut[];
  // Per-player plant directions (one per plant slot), assigned from optionals.combinations.plant
  // at world creation. Empty when the raid has no plant combinations. Stamped onto each plant
  // debuff as it lands so the HUD arrow + trap use the player's assigned heading.
  plantPlan: Record<string, [number, number][]>;
  // Optional mapping from plant application order to combo slot. This lets a short-timer debuff
  // use a later combo slot while the displayed/solver combo order remains stable.
  plantDebuffOrder?: number[];
  botSolvers?: BotSolvers;
  // Generic pairing/grouping support, populated at world build (any mechanic can fill these):
  // - partners: player id -> its paired player id (for when.partnerDebuff).
  // - playerGroups: player id -> its group label (for when.soaks vs a mechanic's group).
  // - initialCharges: player id -> the charge kind a `reassign` event's `initial: "plan"` deal applies.
  // - endingOffsets: stored ending event id -> selected directionOffset.
  // - eventPositions: static positioned event id -> position (for explicit frame: [ids]).
  partners: Record<string, string>;
  playerGroups: Record<string, string>;
  initialCharges: Record<string, string>;
  endingOffsets: Record<string, number>;
  eventPositions: Record<string, Vec2>;
};
