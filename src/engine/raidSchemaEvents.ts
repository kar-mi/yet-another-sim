import { z } from "zod";
import { DEBUFF_REGISTRY } from "./status/debuffs";
import { EventIdSchema, RoleSchema, Vec2Schema } from "./raidSchemaPrimitives";
import { AOEShapeSchema, ApplyEffectSchema, ApplyEffectsSchema, KnockbackSchema } from "./raidSchemaFoundation";

const TelegraphModeSchema = z.enum(["cast", "resolve"]);
const BossRelativeCenterSchema = z.object({
  lateral: z.number(),
  forward: z.number(),
});

const AOEEventSchema = z.object({
  type: z.literal("aoe").default("aoe"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  labels: z.array(z.string().min(1)).optional(), // bot-solver labels (GenericSolverRule.when.mechanic)
  group: z.string().min(1).optional(),           // bot-solver group (GenericSolverRule.when.soaks)
  telegraph: z.number().positive(),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  shape: AOEShapeSchema,
  applyEffect: ApplyEffectSchema.optional(),
  applyEffects: ApplyEffectsSchema.optional(),
  knockback: KnockbackSchema.optional(),
  // Facing-relative anchoring for cone/rect: snapshot the boss at cast start.
  anchor: z.literal("boss").optional(),            // origin = boss.pos
  directionFrom: z.literal("bossFacing").optional(), // shape direction = boss.facing
  directionOffset: z.number().optional(),          // rotate the bossFacing direction (radians, clockwise)
  aimAtPlayer: z.string().min(1).optional(),       // cone/rect direction snapshots toward this player id
  // The boss freezes its facing for the duration of the cast (telegraph), then resumes.
  // Defaults to true; set false to let the boss keep tracking its target mid-cast.
  lockFacing: z.boolean().default(true),
  // The boss does not move toward its target during the cast. Defaults to true.
  bossStationary: z.boolean().default(true),
  // Store this cleave: do NOT resolve at its own cast end. A linked `bait` (see BaitEventSchema.link)
  // arms and detonates it, computing the cone/rect geometry from the boss's locked facing at that time.
  deferred: z.boolean().default(false),
  // Raidwide HP check: ignore position and deal damage to every alive player below full HP; spare players at full HP.
  requireFullHp: z.boolean().default(false),
  // Directional gate: only hit players whose bearing from the boss is within this arc.
  // `center` (radians, clockwise from boss facing; 0 = front) and full `width` (radians).
  positional: z.object({
    center: z.number(),
    width: z.number().positive().max(Math.PI * 2),
  }).optional(),
  showCastBar: z.boolean().optional(),
  showTelegraph: z.boolean().optional(),
  telegraphMode: TelegraphModeSchema.optional(),
  bossRelativeCenter: BossRelativeCenterSchema.optional(),
  // Render-only: during the final `lead` seconds before resolve, flash the AoE footprint
  // in `color` (hex; defaults to light blue). Drawn even when showTelegraph is false.
  flashBeforeResolve: z.object({
    lead: z.number().positive(),
    color: z.string().optional(),
  }).optional(),
  // Render-only: ground telegraph color (hex). Defaults to the standard danger red when omitted.
  color: z.string().min(1).optional(),
  bossId: z.string().min(1).optional(),
});

const TargetedEventSchema = z.object({
  type: z.literal("targeted"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  labels: z.array(z.string().min(1)).optional(), // bot-solver labels (GenericSolverRule.when.mechanic)
  group: z.string().min(1).optional(),           // bot-solver group (GenericSolverRule.when.soaks)
  targetMode: z.enum(["closest", "furthest", "aggro"]),
  role: RoleSchema.optional(),
  // When > 1, the cast hits the N nearest/furthest players, dropping a damage circle on each
  // (a spread). Ignored for targetMode "aggro".
  count: z.number().int().positive().optional(),
  radius: z.number().positive(),
  telegraph: z.number().positive(),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  applyEffect: ApplyEffectSchema.optional(),
  showCastBar: z.boolean().optional(),
  showTelegraph: z.boolean().optional(),
  telegraphMode: TelegraphModeSchema.optional(),
  color: z.string().min(1).optional(),
  bossId: z.string().min(1).optional(),
});

// A baited cast (targeting only — deals no damage itself): at cast START a player is selected
// (random/closest/furthest), the boss turns to face them and locks facing for the cast. `link` names
// a deferred `aoe` (stored cleave); that cleave is aimed from the locked facing and detonates at cast END.
const BaitEventSchema = z.object({
  type: z.literal("bait"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  labels: z.array(z.string().min(1)).optional(), // bot-solver labels (GenericSolverRule.when.mechanic)
  group: z.string().min(1).optional(),           // bot-solver group (GenericSolverRule.when.soaks)
  targetMode: z.enum(["random", "closest", "furthest"]),
  role: RoleSchema.optional(),
  telegraph: z.number().positive(),
  // Id of the deferred `aoe` (stored cleave) this bait aims and detonates at cast end.
  link: z.string().min(1),
  // If the selected bait target has one of these active effect names, override the linked stored
  // cleave's directionOffset for this bait. Used by Forsaken Past/Future Ending.
  directionOffsetByEffect: z.record(z.string().min(1), z.number()).optional(),
  showCastBar: z.boolean().optional(),
  bossId: z.string().min(1).optional(),
});

const DashEventSchema = z.object({
  type: z.literal("dash"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  labels: z.array(z.string().min(1)).optional(),
  group: z.string().min(1).optional(),
  bossId: z.string().min(1).optional(),
  telegraph: z.number().positive(),
  link: z.string().min(1),
  destination: z.union([
    z.strictObject({ to: Vec2Schema }),
    z.strictObject({ debuff: z.string().min(1) }),
    z.strictObject({ bait: z.enum(["closest", "furthest", "random", "aggro"]), role: RoleSchema.optional() }),
  ]),
  showCastBar: z.boolean().optional(),
});

const TetherSourceEventSchema = z.object({
  type: z.literal("tether_source"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  pos: Vec2Schema.optional(),
  fromBlackHoleOrb: z.object({
    hazardId: EventIdSchema,
    // Clockwise slot (not physical orb index): 0/1/2 = 1st/2nd/3rd orb clockwise from the hazard's
    // orderFrom boss, resolved to a position from the locked order at fire time.
    order: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  }).optional(),
  finalizeAfter: z.number().positive(),
  fireOffsets: z.array(z.number().nonnegative()).min(1).optional(),
  despawnAfter: z.number().positive().optional(),
  tetherKind: z.enum(["buff", "debuff"]),
  buffName: z.string().min(1),  // log/visual label; independent of applyEffect's own name
  applyEffect: ApplyEffectSchema.optional(),
  showSource: z.boolean().default(true),
  beam: z.object({
    width: z.number().positive(),
    length: z.number().positive(),
    damage: z.number().nonnegative(),
    damageType: z.enum(["physical", "magical", "true"]).default("true"),
    applyEffect: ApplyEffectSchema.optional(),
    pointing: Vec2Schema.optional(),
  }).optional(),
}).superRefine((ev, ctx) => {
  if ((ev.pos !== undefined) === (ev.fromBlackHoleOrb !== undefined)) {
    ctx.addIssue({
      code: "custom",
      path: ["pos"],
      message: "tether_source must specify exactly one of pos or fromBlackHoleOrb",
    });
  }
  if (ev.fireOffsets !== undefined && ev.despawnAfter === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["despawnAfter"],
      message: "despawnAfter is required when fireOffsets is set",
    });
  }
  if (ev.fireOffsets !== undefined && ev.despawnAfter !== undefined && Math.max(...ev.fireOffsets) > ev.despawnAfter) {
    ctx.addIssue({
      code: "custom",
      path: ["fireOffsets"],
      message: "fireOffsets must resolve before despawnAfter",
    });
  }
  if (ev.applyEffect !== undefined && ev.applyEffect.kind !== ev.tetherKind) {
    ctx.addIssue({
      code: "custom",
      path: ["applyEffect", "kind"],
      message: `applyEffect.kind "${ev.applyEffect.kind}" must match tetherKind "${ev.tetherKind}"`,
    });
  }
});

const LineLinkTargetSchema = z.object({
  mode: z.enum(["closest", "furthest"]).default("closest"),
  roles: z.array(RoleSchema).min(1).optional(),
  roleGroups: z.array(z.array(RoleSchema).min(1)).length(2).optional(),
  playerIds: z.array(z.string().min(1)).min(1).optional(),
  count: z.number().int().positive().optional(),
}).default({ mode: "closest" });

const LineLinkVisualSchema = z.object({
  kind: z.literal("statue").default("statue"),
  width: z.number().positive().default(2.5),
  height: z.number().positive().default(4),
  depth: z.number().positive().default(1),
});

const LineLinkEventSchema = z.object({
  type: z.literal("line_link"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  pos: Vec2Schema,
  resolveAfter: z.number().positive(),
  linkDuration: z.number().positive().optional(),
  rng: z.boolean().optional(),
  link: z.string().min(1).optional(),
  target: LineLinkTargetSchema,
  hiddenDebuff: z.string().min(1),
  applyEffect: ApplyEffectSchema.optional(),
  knockback: KnockbackSchema.optional(),
  visual: LineLinkVisualSchema.optional(),
}).transform((event, ctx) => {
  const spec = DEBUFF_REGISTRY[event.hiddenDebuff];
  if (!spec) {
    ctx.addIssue({ code: "custom", path: ["hiddenDebuff"], message: `unknown debuff ref "${event.hiddenDebuff}"` });
    return z.NEVER;
  }
  const { hiddenDebuff, ...rest } = event;
  return { ...rest, hiddenDebuffName: spec.name };
});

const TowerVisualSchema = z.object({
  pillar: z.boolean().optional(),          // static rectangle column in the center
  countCircles: z.boolean().optional(),    // one floor circle per required soaker
  fallingCylinder: z.boolean().optional(), // cylinder descending in time with the cast
  fallingObject: z.enum(["cylinder", "sphere", "box"]).optional(),
  groundStyle: z.enum(["standard", "tank"]).optional(), // standard: yellow inner/red outer; tank: two red
  cylinderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), // falling cylinder color
  cylinderThickness: z.number().positive().optional(), // falling object diameter/width
  fallingObjectAlpha: z.number().min(0).max(1).optional(), // falling object opacity
});

const TowerEventSchema = z.object({
  type: z.literal("tower"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  labels: z.array(z.string().min(1)).optional(), // bot-solver labels (GenericSolverRule.when.mechanic)
  group: z.string().min(1).optional(),           // bot-solver group (GenericSolverRule.when.soaks)
  telegraph: z.number().positive(),
  pos: Vec2Schema,
  radius: z.number().positive(),
  requiredCount: z.number().int().positive().default(1), // soakers needed to clear it
  requiredRoles: z.array(RoleSchema).min(1).optional(),
  wrongRoleLethal: z.boolean().optional(), // wrong-role soaker dies (only with requiredRoles)
  failureDamage: z.number().nonnegative(), // raidwide damage when not enough valid soakers
  failureDamageType: z.enum(["physical", "magical", "true"]),
  applyEffect: ApplyEffectSchema.optional(), // debuff applied to valid soakers on success
  consumeEffect: z.object({ effectName: z.string().min(1), stacks: z.number().int().positive().default(1) }).optional(),
  knockback: KnockbackSchema.optional(),     // knockback applied to valid soakers on success
  resolveEventIds: z.array(EventIdSchema).optional(), // effect_resolver ids invoked for valid inside soakers
  visual: TowerVisualSchema.optional(),
});

const EffectResolverActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("spread"),
    radius: z.number().positive(),
    damage: z.number().nonnegative(),
    damageType: z.enum(["physical", "magical", "true"]),
  }),
  z.object({
    kind: z.literal("stack"),
    radius: z.number().positive(),
    requiredCount: z.number().int().positive().default(1),
    damage: z.number().nonnegative(),
    damageType: z.enum(["physical", "magical", "true"]),
  }),
  z.object({
    kind: z.literal("cone_nearest"),
    angleDeg: z.number().positive().max(360),
    length: z.number().positive(),
    damage: z.number().nonnegative(),
    damageType: z.enum(["physical", "magical", "true"]),
  }),
]);

const EffectResolverEventSchema = z.object({
  type: z.literal("effect_resolver"),
  id: EventIdSchema,
  name: z.string().min(1),
  effectName: z.string().min(1),
  action: EffectResolverActionSchema,
});

const ChainEventSchema = z.object({
  type: z.literal("chain"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  pairs: z.array(z.tuple([z.string().min(1), z.string().min(1)])).min(1), // chained player-id pairs
  telegraph: z.number().positive(),     // cast duration (head icon + cast bar)
  breakWindow: z.number().positive(),   // seconds after the cast to move apart before damage
  breakDistance: z.number().positive(), // separation needed to break the chain
  breakDamage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  debuff: z.string().min(1),            // registered debuff applied to both members at cast end
  showCastBar: z.boolean().optional(),
}).transform((event, ctx) => {
  const spec = DEBUFF_REGISTRY[event.debuff];
  if (!spec) {
    ctx.addIssue({ code: "custom", path: ["debuff"], message: `unknown debuff ref "${event.debuff}"` });
    return z.NEVER;
  }
  const { debuff, ...rest } = event;
  return { ...rest, debuffName: spec.name };
});

const GroupEventSchema = z.object({
  type: z.literal("group"),
  time: z.number().nonnegative(),
  name: z.string().min(1),
  id: EventIdSchema,
  groups: z.array(z.array(z.string().min(1)).min(1)).min(1),     // candidate groups of player ids
  rng: z.boolean().optional(),                                   // pick a random group (else groups[0])
  link: z.string().min(1).optional(),                            // take complement of the referenced group event's choice
  telegraph: z.number().positive(),
  radius: z.number().positive(),                                 // stack circle radius around the marked player
  requiredCount: z.number().int().positive().default(1),         // soakers needed inside the radius; fewer -> stack fails (full damage each)
  damage: z.number().nonnegative(),                              // total damage, split evenly among soakers on success
  damageType: z.enum(["physical", "magical", "true"]),
  applyEffect: ApplyEffectSchema.optional(),
  showCastBar: z.boolean().optional(),
  showMarker: z.boolean().default(true),
  showTelegraph: z.boolean().default(true),
  // Render-only: stack circle color (hex). Defaults to the standard "stack here" blue when omitted.
  color: z.string().min(1).optional(),
});

const EffectSelectEventSchema = z.object({
  type: z.literal("effect_select"),
  time: z.number().nonnegative(),
  name: z.string().min(1),
  id: EventIdSchema,
  groups: z.array(z.array(z.string().min(1)).min(1)).min(1),
  rng: z.boolean().optional(),
  link: z.string().min(1).optional(),
  applyEffect: ApplyEffectSchema,
});

// Standalone "drop this effect on players now" event. No telegraph — it lands at time t.
// Targeting: `players` ids if given, else `role` filter, else everyone alive. `count` caps how many
// targets (random selection when `rng`, else roster order). Events sharing an `assignGroup`
// in the same tick exclude players picked by earlier events in that group.
const ApplyEffectEventSchema = z.object({
  type: z.literal("apply_effect"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  role: RoleSchema.optional(),
  players: z.array(z.string().min(1)).min(1).optional(),
  count: z.number().int().positive().optional(),
  assignGroup: z.string().min(1).optional(),
  rng: z.boolean().optional(),
  applyEffect: ApplyEffectSchema.optional(),
  applyEffectChoices: z.tuple([ApplyEffectSchema, ApplyEffectSchema]).optional(),
  effectChoiceGroup: z.string().min(1).optional(),
  effectChoiceComplement: z.boolean().optional(),
}).superRefine((event, ctx) => {
  if ((event.applyEffect === undefined) === (event.applyEffectChoices === undefined)) {
    ctx.addIssue({
      code: "custom",
      path: ["applyEffect"],
      message: "apply_effect must specify exactly one of applyEffect or applyEffectChoices",
    });
  }
});

const InverseEventSchema = z.object({
  type: z.literal("inverse"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  telegraph: z.number().positive(),                // cast/telegraph duration (seconds)
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  shownShapes: z.array(AOEShapeSchema).min(1),      // telegraph shapes that ARE drawn
  hiddenShapes: z.array(AOEShapeSchema).min(1),     // not drawn; lethal when inverted ("?")
  shownShapesB: z.array(AOEShapeSchema).min(1).optional(),  // variant-b telegraph shapes (rolled when variantRng)
  hiddenShapesB: z.array(AOEShapeSchema).min(1).optional(), // variant-b hidden shapes
  variantRng: z.boolean().optional(),               // randomize a/b orientation (needs shownShapesB + hiddenShapesB)
  ringColor: z.string().optional(),               // hex colour of this mechanic's boss ring (identifies it)
  ringHeight: z.number().optional(),              // vertical height of this mechanic's boss ring
  telegraphAlpha: z.number().min(0).max(1).optional(), // optional fixed alpha for shown telegraph footprints
  // Render-only: shownShapes fill color (hex). Defaults to ringColor, else blue/red by inverted state.
  color: z.string().min(1).optional(),
  rng: z.boolean().optional(),                      // randomize the "?" inversion (else not inverted)
  questionMark: z.boolean().optional(),            // authored override of the inversion state
  applyEffect: ApplyEffectSchema.optional(),
  knockback: KnockbackSchema.optional(),
  showCastBar: z.boolean().optional(),
}).superRefine((ev, ctx) => {
  if (ev.variantRng && (!ev.shownShapesB || !ev.hiddenShapesB)) {
    ctx.addIssue({ code: "custom", message: "variantRng requires both shownShapesB and hiddenShapesB" });
  }
});

// A "?" mechanic that flips between spread (per-player AOEs) and stack (shared soak). It shows one
// marker during the cast; when inverted ("?") it resolves as the opposite when the cast bar ends.
const SpreadStackEventSchema = z.object({
  type: z.literal("spread_stack"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  telegraph: z.number().positive(),
  shown: z.enum(["spread", "stack", "random"]),     // marker drawn during the cast ("random" = seeded per pull)
  rng: z.boolean().optional(),                       // seeded 50/50 flip (else honest)
  questionMark: z.boolean().optional(),              // authored override of the flip state
  damageType: z.enum(["physical", "magical", "true"]),
  spread: z.object({
    radius: z.number().positive(),                   // each player's personal AOE radius
    damage: z.number().nonnegative(),                // damage per circle a player stands in
  }),
  stack: z.object({
    groups: z.array(z.array(z.string().min(1)).min(1)).min(1), // candidate groups; one member is marked
    radius: z.number().positive(),                   // stack circle radius around the marked player
    requiredCount: z.number().int().positive().default(1),     // soakers needed; fewer -> full damage each
    damage: z.number().nonnegative(),                // total, split evenly among soakers on success
  }),
  stackCarriers: z.string().min(1).optional(),
  spreadCarriers: z.string().min(1).optional(),
  ringColor: z.string().optional(),                  // hex colour of this mechanic's boss ring
  ringHeight: z.number().optional(),                 // vertical height of this mechanic's boss ring
  showCastBar: z.boolean().optional(),
}).superRefine((event, ctx) => {
  if ((event.stackCarriers === undefined) !== (event.spreadCarriers === undefined)) {
    ctx.addIssue({ code: "custom", message: "stackCarriers and spreadCarriers must be provided together" });
  }
});

const GazeVisualSchema = z.object({
  width: z.number().positive().default(4),  // eye board dimensions
  height: z.number().positive().default(3),
  depth: z.number().positive().default(0.4),
});

const GazeEventSchema = z.object({
  type: z.literal("gaze"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  telegraph: z.number().positive(),                // cast/telegraph duration (seconds)
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  pos: Vec2Schema.optional(),                       // position of the eye/source (e.g. north)
  carriers: z.string().min(1).optional(),
  carrierCone: z.object({ angleDeg: z.number().positive().max(360), length: z.number().positive() }).optional(),
  reverse: z.boolean().optional(),                 // false (eye): hit if looking at it; true ("?" eye): hit if NOT looking
  rng: z.boolean().optional(),                     // randomize the reverse state at cast start (seeded)
  coneHalfAngle: z.number().positive().optional(), // half-angle (radians) counted as "looking at" it (default PI/2 = front 180)
  applyEffect: ApplyEffectSchema.optional(),
  knockback: KnockbackSchema.optional(),
  showCastBar: z.boolean().optional(),
  visual: GazeVisualSchema.optional(),
  // Render-only: carrier cone fill color (hex). Defaults to orange/blue by reverse state when omitted.
  color: z.string().min(1).optional(),
}).superRefine((event, ctx) => {
  if (event.pos === undefined && event.carriers === undefined) {
    ctx.addIssue({ code: "custom", path: ["pos"], message: "gaze needs pos or carriers" });
  }
  if (event.carriers !== undefined && event.reverse !== true && event.carrierCone === undefined) {
    ctx.addIssue({ code: "custom", path: ["carrierCone"], message: "normal carrier gaze needs carrierCone" });
  }
});

const ForcedMarchEventSchema = z.object({
  type: z.literal("forced_march"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  pos: Vec2Schema,                         // center of the ground trigger zone
  radius: z.number().positive(),           // trigger zone radius
  direction: Vec2Schema,                   // arrow / teleport direction (non-zero)
  distance: z.number().positive(),         // teleport distance along direction
  duration: z.number().positive(),         // how long the trap stays armed
  preDelay: z.number().nonnegative().default(0.3),  // frozen on the trap before the teleport
  postDelay: z.number().nonnegative().default(0.3), // frozen at the destination after the teleport
}).superRefine((ev, ctx) => {
  if (ev.direction[0] === 0 && ev.direction[1] === 0) {
    ctx.addIssue({ code: "custom", path: ["direction"], message: "forced_march direction must be a non-zero vector" });
  }
});

const BlackHoleOrbSchema = z.object({
  pos: Vec2Schema,
  tether: z.boolean(),
});

const HazardEventSchema = z.object({
  type: z.literal("hazard"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  spots: z.array(Vec2Schema).min(1).optional(),
  blackHole: z.object({
    combos: z.array(z.array(BlackHoleOrbSchema).min(1)).min(1),
    // Boss whose bearing the tether orbs are ordered clockwise from (e.g. bigkefka). Required only
    // when a tether_source or frame references this hazard by clockwise order.
    orderFrom: EventIdSchema.optional(),
  }).optional(),
  radius: z.number().positive(),
  duration: z.number().positive(),
  armingTime: z.number().nonnegative().default(0),
  applyEffect: ApplyEffectSchema,
}).superRefine((ev, ctx) => {
  const hasSpots = ev.spots !== undefined && ev.spots.length > 0;
  if ((ev.blackHole !== undefined) === hasSpots) {
    ctx.addIssue({
      code: "custom",
      path: ["spots"],
      message: "hazard must specify exactly one of spots or blackHole",
    });
  }
});

const DivebombEventSchema = z.object({
  type: z.literal("divebomb"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  from: Vec2Schema,
  to: Vec2Schema,
  speed: z.number().positive(),
  size: z.number().positive(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ff5533"),
  gap: z.number().positive().optional(),
  damage: z.number().nonnegative().optional(),
  damageType: z.enum(["physical", "magical", "true"]).default("physical"),
  applyEffect: ApplyEffectSchema.optional(),
  hitInterval: z.number().positive().optional(),
  teleportBoss: z.string().min(1).optional(),  // on cast start, move this boss to `from` (facing `to`) and unhide it
  hideBoss: z.string().min(1).optional(),       // on cast start, hide this boss's model
  // "step" (default): one sphere advancing slot-by-slot. "line": a sphere per slot that pops in
  // sequentially from `from` to `to`, building a line (purely visual — pair with damage: 0).
  visual: z.enum(["step", "line"]).default("step"),
}).superRefine((ev, ctx) => {
  if (ev.from[0] === ev.to[0] && ev.from[1] === ev.to[1]) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "divebomb endpoints must be distinct" });
  }
});

const BossTeleportEventSchema = z.object({
  type: z.literal("teleport_boss"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  bossId: z.string().min(1),
  spots: z.array(Vec2Schema).min(1),
  rng: z.boolean().default(false),
});

const EffectBurstEventSchema = z.object({
  type: z.literal("effect_burst"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  telegraph: z.number().positive(),                // cast/telegraph duration (seconds)
  effectName: z.string().min(1),                   // burst around each player carrying this effect
  radius: z.number().positive(),                   // AOE radius around each carrier
  innerRadius: z.number().positive().optional(),
  shownShape: z.enum(["circle", "donut"]).default("circle"),
  hiddenShape: z.enum(["circle", "donut"]).default("circle"),
  rng: z.boolean().optional(),
  questionMark: z.boolean().optional(),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  applyEffect: ApplyEffectSchema.optional(),
  knockback: KnockbackSchema.optional(),
  showCastBar: z.boolean().optional(),
  showTelegraph: z.boolean().optional(),
  telegraphMode: TelegraphModeSchema.optional(),
  color: z.string().min(1).optional(),
}).superRefine((event, ctx) => {
  if ((event.shownShape === "donut" || event.hiddenShape === "donut")
    && (event.innerRadius === undefined || event.innerRadius >= event.radius)) {
    ctx.addIssue({ code: "custom", path: ["innerRadius"], message: "donut effect_burst needs innerRadius smaller than radius" });
  }
});

const EffectCheckEventSchema = z.object({
  type: z.literal("effect_check"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  checks: z.array(z.object({ carriers: z.string().min(1), compare: z.tuple([z.string().min(1), z.string().min(1)]), expect: z.enum(["matches", "differs"]) })).min(1),
  failureDamage: z.number().nonnegative(),
  failureDamageType: z.enum(["physical", "magical", "true"]),
});

const HealEventSchema = z.object({
  type: z.literal("heal"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
});

const SetHpEventSchema = z.object({
  type: z.literal("set_hp"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  amount: z.number().positive(),
  role: RoleSchema.optional(),
  players: z.array(z.string().min(1)).min(1).optional(),
});

// Generic charge distribution + re-balance. `charges` lists each kind's effect (+ optional above-head
// marker). `initial: "plan"` opens by applying each player's planned kind from world.initialCharges.
// `onResolve` keys a trigger label (e.g. a tower's label) to the per-kind target counts the re-balance
// should reach, dealt to the just-resolved players in roster order.
const ReassignChargeSchema = z.object({
  kind: z.string().min(1),
  effect: ApplyEffectSchema,
  marker: ApplyEffectSchema.optional(),
});
const ReassignEventSchema = z.object({
  type: z.literal("reassign"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  charges: z.array(ReassignChargeSchema).min(1),
  initial: z.literal("plan").optional(),
  onResolve: z.record(z.string().min(1), z.record(z.string().min(1), z.number().int().nonnegative())).optional(),
}).superRefine((ev, ctx) => {
  const kinds = new Set(ev.charges.map(c => c.kind));
  for (const [label, counts] of Object.entries(ev.onResolve ?? {})) {
    for (const kind of Object.keys(counts)) {
      if (!kinds.has(kind)) {
        ctx.addIssue({ code: "custom", path: ["onResolve", label, kind], message: `onResolve references unknown charge kind "${kind}"` });
      }
    }
  }
});

// Assigns each player a unique numbered marker (1–8) via a seeded Fisher-Yates shuffle.
// The `effect` template is cloned per player with marker overridden to String(i+1).
const LimitCutEventSchema = z.object({
  type: z.literal("limit_cut"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  effect: ApplyEffectSchema,
  players: z.array(z.string().min(1)).min(1).optional(),
  role: RoleSchema.optional(),
  // Optional bot-solver placement basis (RNG-ready). `kefkaStart` is the direction Kefka's first
  // divebomb comes from; relative-north is its opposite. `kefkaClockwise` is Kefka's dash rotation;
  // players place in the opposite direction. Defaults to N start / CCW (the current hardcoded case).
  rotation: z.object({ kefkaStart: Vec2Schema, kefkaClockwise: z.boolean() }).optional(),
});

export const EventSchema = z.preprocess(
  value => typeof value === "object" && value !== null && "t" in value && !("time" in value)
    ? { ...value, time: value.t }
    : value,
  z.union([TetherSourceEventSchema, LineLinkEventSchema, AOEEventSchema, TargetedEventSchema, BaitEventSchema, DashEventSchema, TowerEventSchema, EffectResolverEventSchema, ChainEventSchema, GroupEventSchema, EffectSelectEventSchema, ApplyEffectEventSchema, LimitCutEventSchema, InverseEventSchema, SpreadStackEventSchema, GazeEventSchema, ForcedMarchEventSchema, HazardEventSchema, DivebombEventSchema, BossTeleportEventSchema, EffectBurstEventSchema, EffectCheckEventSchema, HealEventSchema, ReassignEventSchema, SetHpEventSchema]),
).transform(event => {
    if (!("time" in event)) return event;
    const { time, ...rest } = event;
    return { ...rest, t: time };
  });
