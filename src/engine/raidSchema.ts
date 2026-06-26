import { z } from "zod";
import { ROSTER, RaidIdSchema } from "@shared/protocol";
import { BOSS_REGISTRY, BOSS_REGISTRY_IDS, DEFAULT_BOSS_ID, isBossRegistryId, type BossRegistryId } from "./bossRegistry";

const Vec2Schema = z.preprocess(
  value => Array.isArray(value) && value.length === 2 ? { x: value[0], z: value[1] } : value,
  z.object({ x: z.number(), z: z.number() }).strict(),
).transform(({ x, z }) => [x, z] as [number, number]);
const WaypointSchema = z.preprocess(
  value => typeof value === "object" && value !== null && "t" in value && !("time" in value)
    ? { ...value, time: value.t }
    : value,
  z.object({ time: z.number().nonnegative(), pos: Vec2Schema }),
).transform(({ time, pos }) => ({ t: time, pos }));
const EventIdSchema = z.string().min(1);
const RoleSchema = z.enum(["tank", "healer", "dps"]);
const DebuffMatchSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
const AbsoluteSpotSchema = z.object({ x: z.number(), z: z.number() }).strict();
const RelativeSpotSchema = z.object({ r: z.number(), z: z.number() }).strict();
const PolarSpotSchema = z.object({ dist: z.number(), angleDeg: z.number() }).strict();
const SolverSpotSchema = z.union([AbsoluteSpotSchema, RelativeSpotSchema, PolarSpotSchema]);
// A single positioned reference summed into a frame's north vector: a positioned event id (tower),
// a resolved elemental crystal, or a boss (its facing direction or position).
const FrameRefSchema = z.union([
  EventIdSchema,
  z.object({ crystal: z.enum(["wind", "fire", "water"]) }),
  z.object({ boss: z.object({
    id: z.string().min(1).optional(),
    from: z.enum(["facing", "position"]),
  }) }),
]);
const GenericSolverFrameSchema = z.union([
  z.literal("matched"),
  z.array(FrameRefSchema).min(1),
]);

const GenericSolverRuleSchema = z.object({
  when: z.object({
    static: z.literal(true).optional(), // explicit always-active fallback
    // segment-prefix match on a resolved mechanic id OR an exact match on one of its labels;
    // an array requires all listed mechanics at once
    mechanic: z.union([EventIdSchema, z.array(EventIdSchema).min(1)]).optional(),
    role: RoleSchema.optional(),
    debuff: DebuffMatchSchema.optional(),        // active effect name(s) on the bot (all required)
    partyDebuff: DebuffMatchSchema.optional(),   // active effect name(s) anywhere in the party
    partnerDebuff: DebuffMatchSchema.optional(), // active effect name(s) on the bot's partner
    soaks: z.boolean().optional(),               // bot's group vs the matched mechanic's group
    plant: z.string().min(1).optional(),  // the bot's assigned plant combo key (e.g. "right right")
    plantSlot: z.number().int().nonnegative().optional(), // restrict to a plant slot; omit to match either
    endingFacing: z.object({ event: EventIdSchema, offset: z.number() }).optional(),
  }),
  startAt: z.number().nonnegative().optional(),
  endAt: z.number().nonnegative().optional(),
  // Rotated spot frame: "matched" (north = bisector of the live matched mechanics) or a list of
  // references (positioned event ids, { crystal }, { boss }) whose positions are summed for north.
  frame: GenericSolverFrameSchema.optional(),
  mirrorLateral: z.boolean().optional(),
  spots: z.record(z.string().min(1), SolverSpotSchema).optional(),
  spot: SolverSpotSchema.optional(),
  // Limit Cut ring placement; `spots[n-1]` (relative/polar) is rotated by the basis of the limit cut
  // named in when.mechanic (see GenericSolverRule.limitCutSpread).
  limitCutSpread: z.object({ spots: z.array(z.union([RelativeSpotSchema, PolarSpotSchema])).min(1) }).optional(),
}).superRefine((rule, ctx) => {
  const hasCondition = rule.when.static === true || rule.when.mechanic !== undefined || rule.when.debuff !== undefined
    || rule.when.partyDebuff !== undefined || rule.when.partnerDebuff !== undefined || rule.when.plant !== undefined;
  if (!hasCondition) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["when"], message: "rule must have when.static: true or at least one of when.mechanic / when.debuff / when.partyDebuff / when.partnerDebuff / when.plant" });
  }
  // limitCutSpread computes absolute coords from each bot's number; it sources its rotation basis
  // from the limit cut named by when.mechanic, and replaces (and forbids) the usual frame/spot/spots
  // placement, so skip those requirements once it's validated.
  if (rule.limitCutSpread !== undefined) {
    if (rule.when.mechanic === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["limitCutSpread"], message: "limitCutSpread requires when.mechanic naming the limit cut" });
    }
    if (rule.frame !== undefined || rule.spot !== undefined || rule.spots !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["limitCutSpread"], message: "limitCutSpread returns absolute coords; do not also set frame / spot / spots" });
    }
    return;
  }
  if ((rule.when.soaks !== undefined || rule.frame === "matched") && rule.when.mechanic === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["when"], message: "when.soaks and frame: \"matched\" require when.mechanic" });
  }
  if (rule.mirrorLateral && !Array.isArray(rule.frame)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mirrorLateral"], message: "mirrorLateral requires a reference-list frame" });
  }
  if (rule.spots === undefined && rule.spot === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["spot"], message: "rule must have at least one of spot / spots" });
  }
  const spots = [rule.spot, ...Object.values(rule.spots ?? {})]
    .filter((spot): spot is NonNullable<typeof spot> => spot !== undefined);
  const hasInvalidSpot = rule.frame === undefined
    ? spots.some(spot => !("x" in spot))
    : spots.some(spot => !("r" in spot) && !("angleDeg" in spot));
  if (hasInvalidSpot) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["spot"],
      message: rule.frame === undefined
        ? "unframed rule requires absolute { x, z } spots"
        : "frame requires relative { r, z } or polar { dist, angleDeg } spots",
    });
  }
});
const SolverHoldSchema = z.object({
  // id-prefix or label match (same matching as when.mechanic); array matches any listed mechanic
  mechanic: z.union([EventIdSchema, z.array(EventIdSchema).min(1)]),
  duration: z.number().positive(), // seconds bots hold position after a matching mechanic resolves
});
const BotSolversSchema = z.object({
  generic: z.array(GenericSolverRuleSchema).optional(),
  holds: z.array(SolverHoldSchema).optional(),
}).optional();

const WaymarkSchema = z.object({
  mark: z.enum(["A", "B", "C", "D", "1", "2", "3", "4"]),
  pos: Vec2Schema,
});

const CrystalsSchema = z.object({
  spawnAt: z.number().nonnegative().optional(),
  spots: z.array(Vec2Schema).length(4),
  rng: z.boolean().default(true),
}).optional();

const FloorPlanSchema = z.enum(["squares", "dmu-p1", "dmu-p2"]).default("squares");

const ZoneShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circle"), center: Vec2Schema, radius: z.number().positive() }),
  z.object({ kind: z.literal("rect"), center: Vec2Schema, width: z.number().positive(), height: z.number().positive() }),
  z.object({ kind: z.literal("polygon"), vertices: z.array(Vec2Schema).min(3) }),
]);

const AOEShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circle"), center: Vec2Schema, radius: z.number().positive() }),
  z.object({ kind: z.literal("donut"), center: Vec2Schema, inner: z.number().nonnegative(), outer: z.number().positive() }),
  z.object({ kind: z.literal("cone"), origin: Vec2Schema.default([0, 0]), direction: Vec2Schema.default([0, 1]), angleDeg: z.number().positive(), length: z.number().positive() }),
  z.object({ kind: z.literal("rect"), origin: Vec2Schema.default([0, 0]), direction: Vec2Schema.default([0, 1]), width: z.number().positive(), length: z.number().positive() }),
]).superRefine((shape, ctx) => {
  if (shape.kind === "donut" && shape.inner >= shape.outer) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "donut inner must be less than outer" });
  }
  if (shape.kind === "cone" && shape.direction[0] === 0 && shape.direction[1] === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cone direction must be a non-zero vector" });
  }
});

const EffectBehaviorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("vuln"), damageType: z.enum(["physical", "magical"]), multiplier: z.number().positive() }),
  z.object({ kind: z.literal("dot"), dps: z.number().nonnegative(), condition: z.enum(["always", "moving", "idle"]).default("always") }),
  z.object({ kind: z.literal("confusion"), damage: z.number().nonnegative(), damageType: z.enum(["physical", "magical", "true"]), radius: z.number().positive() }),
  z.object({ kind: z.literal("sleep") }),
  z.object({
    kind: z.literal("burstSpread"),
    radius: z.number().positive().default(3),
    damage: z.number().nonnegative(),
    damageType: z.enum(["physical", "magical", "true"]),
    knockbackDistance: z.number().nonnegative().default(6),
    selfShape: z.enum(["circle", "donut"]).default("circle"),
    selfInner: z.number().positive().optional(),
    followUp: z.object({
      mode: z.enum(["closest", "furthest"]).default("closest"),
      count: z.number().int().positive().default(2),
      originCrystal: z.enum(["wind", "fire", "water"]).optional(),
      shape: z.enum(["circle", "donut"]).default("circle"),
      radius: z.number().positive(),
      inner: z.number().positive().optional(),
      damage: z.number().nonnegative(),
      damageType: z.enum(["physical", "magical", "true"]),
      knockbackDistance: z.number().positive().optional(),
    }).optional(),
  }),
  z.object({
    kind: z.literal("plant"),
    // A literal [x, z] heading, or "option" to defer to the combination plan (see Optional
    // combinations). "option" resolves to a placeholder vector that the plan overrides per player.
    direction: z.union([
      Vec2Schema.refine(([x, z]) => x !== 0 || z !== 0, "plant direction must be a non-zero vector"),
      z.literal("option"),
    ]).transform(d => (d === "option" ? [0, 1] : d) as [number, number]),
    distance: z.number().positive(),
    radius: z.number().positive().default(3),        // trap trigger-zone radius
    armDelay: z.number().nonnegative().default(3),   // seconds the placed trap is inert before it can trigger
    duration: z.number().positive().default(10),     // seconds the armed trap lasts before expiring untriggered
    tpDelay: z.number().nonnegative().default(0.7),  // windup seconds frozen at A before the instant teleport to B
  }),
  z.object({
    kind: z.literal("directionalKnockback"),
    requiredFacing: z.enum(["away", "toward"]),
    distance: z.number().nonnegative(),
    doubledDistance: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal("primordialCrust"),
    expiryDamage: z.number().nonnegative(),
    expiryDamageType: z.enum(["physical", "magical", "true"]).default("true"),
  }),
  z.object({
    kind: z.literal("accretion"),
    expiryDamage: z.number().nonnegative(),
    expiryDamageType: z.enum(["physical", "magical", "true"]).default("true"),
  }),
  z.object({
    kind: z.literal("assignment"),
    expiryDamage: z.number().nonnegative(),
    expiryDamageType: z.enum(["physical", "magical", "true"]).default("true"),
  }),
]).superRefine((b, ctx) => {
  if (b.kind !== "burstSpread") return;
  if (b.selfShape === "donut" && b.selfInner === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["selfInner"], message: "selfInner is required when selfShape is \"donut\"" });
  }
  if (b.selfShape === "donut" && b.selfInner !== undefined && b.selfInner >= b.radius) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["selfInner"], message: "selfInner must be less than radius" });
  }
  if (b.followUp?.shape === "donut" && b.followUp.inner === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["followUp", "inner"], message: "followUp.inner is required when followUp.shape is \"donut\"" });
  }
  if (b.followUp?.shape === "donut" && b.followUp.inner !== undefined && b.followUp.inner >= b.followUp.radius) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["followUp", "inner"], message: "followUp.inner must be less than followUp.radius" });
  }
});

const ApplyEffectSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["buff", "debuff"]),
  duration: z.number().positive(),
  behavior: EffectBehaviorSchema,
  visibility: z.enum(["visible", "invisible"]).optional(),
  icon: z.string().min(1).optional(),   // HUD icon filename, served from /static/debuffs/
  marker: z.string().min(1).max(8).optional(), // short above-head marker shown while active
  markerIcon: z.string().min(1).optional(), // above-head marker image filename, served from /static/head_markers/
  markerIconScale: z.number().positive().optional(), // per-icon size multiplier (default 4)
});

const ApplyEffectsSchema = z.object({
  effects: z.array(ApplyEffectSchema).min(1),
  order: z.enum(["listed", "shuffle", "shuffleBalanced"]).default("listed"),
});

const KnockbackSchema = z.object({
  distance: z.number().positive(),
  height: z.number().nonnegative().default(0), // 0 = horizontal knockback; >0 = knockup arc
  origin: Vec2Schema.optional(),               // defaults to the AOE shape's center/origin
});
const TelegraphModeSchema = z.enum(["cast", "resolve"]);

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
  // Render-only: during the final `lead` seconds before resolve, flash the AoE footprint
  // in `color` (hex; defaults to light blue). Drawn even when showTelegraph is false.
  flashBeforeResolve: z.object({
    lead: z.number().positive(),
    color: z.string().optional(),
  }).optional(),
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
    z.object({ to: Vec2Schema }).strict(),
    z.object({ debuff: z.string().min(1) }).strict(),
    z.object({ bait: z.enum(["closest", "furthest", "random", "aggro"]), role: RoleSchema.optional() }).strict(),
  ]),
  showCastBar: z.boolean().optional(),
});

const TetherSourceEventSchema = z.object({
  type: z.literal("tether_source"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  pos: Vec2Schema,
  finalizeAfter: z.number().positive(),
  tetherKind: z.enum(["buff", "debuff"]),
  buffName: z.string().min(1),
  behavior: EffectBehaviorSchema.default({ kind: "none" }),
  effectDuration: z.number().positive().default(15),
  icon: z.string().min(1).optional(),   // HUD icon filename for the tether buff, served from /static/debuffs/
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
  hiddenDebuffName: z.string().min(1),
  applyEffect: ApplyEffectSchema.optional(),
  knockback: KnockbackSchema.optional(),
  visual: LineLinkVisualSchema.optional(),
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
  debuffName: z.string().min(1),        // debuff applied to both members at cast end
  showCastBar: z.boolean().optional(),
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
      code: z.ZodIssueCode.custom,
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
  rng: z.boolean().optional(),                      // randomize the "?" inversion (else not inverted)
  questionMark: z.boolean().optional(),            // authored override of the inversion state
  applyEffect: ApplyEffectSchema.optional(),
  knockback: KnockbackSchema.optional(),
  showCastBar: z.boolean().optional(),
}).superRefine((ev, ctx) => {
  if (ev.variantRng && (!ev.shownShapesB || !ev.hiddenShapesB)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "variantRng requires both shownShapesB and hiddenShapesB" });
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
  ringColor: z.string().optional(),                  // hex colour of this mechanic's boss ring
  ringHeight: z.number().optional(),                 // vertical height of this mechanic's boss ring
  showCastBar: z.boolean().optional(),
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
  pos: Vec2Schema,                                 // position of the eye/source (e.g. north)
  reverse: z.boolean().optional(),                 // false (eye): hit if looking at it; true ("?" eye): hit if NOT looking
  rng: z.boolean().optional(),                     // randomize the reverse state at cast start (seeded)
  coneHalfAngle: z.number().positive().optional(), // half-angle (radians) counted as "looking at" it (default PI/2 = front 180)
  applyEffect: ApplyEffectSchema.optional(),
  knockback: KnockbackSchema.optional(),
  showCastBar: z.boolean().optional(),
  visual: GazeVisualSchema.optional(),
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
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["direction"], message: "forced_march direction must be a non-zero vector" });
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
}).superRefine((ev, ctx) => {
  if (ev.from[0] === ev.to[0] && ev.from[1] === ev.to[1]) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "divebomb endpoints must be distinct" });
  }
});

const EffectBurstEventSchema = z.object({
  type: z.literal("effect_burst"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  telegraph: z.number().positive(),                // cast/telegraph duration (seconds)
  effectName: z.string().min(1),                   // burst around each player carrying this effect
  radius: z.number().positive(),                   // AOE radius around each carrier
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  applyEffect: ApplyEffectSchema.optional(),
  knockback: KnockbackSchema.optional(),
  showCastBar: z.boolean().optional(),
  showTelegraph: z.boolean().optional(),
  telegraphMode: TelegraphModeSchema.optional(),
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
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["onResolve", label, kind], message: `onResolve references unknown charge kind "${kind}"` });
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
  z.union([TetherSourceEventSchema, LineLinkEventSchema, AOEEventSchema, TargetedEventSchema, BaitEventSchema, DashEventSchema, TowerEventSchema, EffectResolverEventSchema, ChainEventSchema, GroupEventSchema, EffectSelectEventSchema, ApplyEffectEventSchema, LimitCutEventSchema, InverseEventSchema, SpreadStackEventSchema, GazeEventSchema, ForcedMarchEventSchema, DivebombEventSchema, EffectBurstEventSchema, HealEventSchema, ReassignEventSchema, SetHpEventSchema]),
).transform(event => {
    if (!("time" in event)) return event;
    const { time, ...rest } = event;
    return { ...rest, t: time };
  });

const PlayerDefSchema = z.object({
  id: z.string().min(1),
  role: RoleSchema,
  spawn: Vec2Schema,
  pattern: z.array(WaypointSchema).optional(),
});

// Cardinal direction constants (more readable than [x, z] vectors). +z = north, +x = east.
const DirectionConstSchema = z.enum(["up", "down", "left", "right"]);
// A plant combination is one cardinal direction per plant slot (e.g. [short, long]).
const PlantComboSchema = z.array(DirectionConstSchema).min(1);
// A plant group: an explicit list of player ids plus the combo pool its members draw from.
// The combo pool is shuffled per seed before assignment, wrapping if there are fewer combos than members.
const PlantGroupSchema = z.object({
  members: z.array(z.string().min(1)).min(1),
  combos: z.array(PlantComboSchema).min(1),
});
// A pairing pair: two player ids, an optional group label (for bot-solver when.soaks) and optional
// per-member initial charge kinds (for a reassign event's `initial: "plan"` opener).
const PairingPairSchema = z.object({
  members: z.tuple([z.string().min(1), z.string().min(1)]),
  group: z.string().min(1).optional(),
  charges: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
});
const PairingPatternSchema = z.object({
  id: z.string().min(1).optional(),
  pairs: z.array(PairingPairSchema).min(1),
});
// Optional per-mechanic combinations. `plant` declares two groups (g1/g2) of members + combos.
// `pairings` declares patterns of player pairs (one selected per run when `rng`), each carrying an
// optional group label + initial charges that feed world.partners / playerGroups / initialCharges.
const OptionalsSchema = z.object({
  // Seeded per-run rotation of tower-wave positions around their canonical ring (see rotateTowerWaves).
  towerRng: z.boolean().default(false),
  orderSwap: z.object({
    rng: z.boolean().default(false),
    groups: z.array(z.array(EventIdSchema).min(1)).length(2),
  }).optional(),
  combinations: z.object({
    plant: z.object({
      rng: z.boolean().default(false),
      debuffOrder: z.array(z.number().int().nonnegative()).optional(),
      g1: PlantGroupSchema,
      g2: PlantGroupSchema,
    }).optional(),
    pairings: z.object({
      rng: z.boolean().default(false),
      patterns: z.array(PairingPatternSchema).min(1),
    }).optional(),
    endings: z.object({
      rng: z.boolean().default(false),
      events: z.array(EventIdSchema).min(1),
      variants: z.array(z.object({ offset: z.number(), name: z.string().min(1).optional() })).min(1),
    }).optional(),
  }).optional(),
}).optional();

// Exhaustive list of glb stems available under /static/model/. Add new boss models here.
export const BOSS_MODEL_NAMES = ["skeith", "kefka", "chaos", "exdeath"] as const;
export type BossModelName = (typeof BOSS_MODEL_NAMES)[number];
const BossModelSchema = z.enum(BOSS_MODEL_NAMES);

const BossSchema = z.object({
  id: z.enum(BOSS_REGISTRY_IDS).optional(),
  pos: Vec2Schema.default([0, 0]),
  radius: z.number().positive().optional(),
  ring: z.object({
    scale: z.number().positive().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }).optional(),
  model: BossModelSchema.optional(),
}).strict().default({ pos: [0, 0] });

// Boss entry in a multi-boss `bosses:` list. Same fields as BossSchema plus a required id slug
// and an optional aggro seed (player id whose threat is pre-seeded to the top so this boss
// faces a specific tank from the start).
const BossWithIdSchema = z.object({
  id: RaidIdSchema,
  pos: Vec2Schema.default([0, 0]),
  radius: z.number().positive().optional(),
  ring: z.object({
    scale: z.number().positive().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }).optional(),
  model: BossModelSchema.optional(),
  aggro: z.string().min(1).optional(),
  targetable: z.boolean().default(true),
}).strict();

type BossIdentityOverrides = {
  model?: BossModelName;
  radius?: number;
  ring?: { scale?: number; color?: string };
};

function resolveBossIdentity(overrides: BossIdentityOverrides, registryId: BossRegistryId) {
  const preset = BOSS_REGISTRY[registryId];
  return {
    model: overrides.model ?? preset.model,
    modelScale: preset.modelScale,
    radius: overrides.radius ?? preset.radius,
    ring: {
      scale: overrides.ring?.scale ?? preset.ring.scale,
      color: overrides.ring?.color ?? preset.ring.color,
    },
  };
}

export const RaidSchema = z.object({
  name: z.string().min(1),
  arena: z.object({ zones: z.array(ZoneShapeSchema).min(1), floorPlan: FloorPlanSchema }),
  duration: z.number().positive(),
  boss: BossSchema,
  // Multi-boss: when present, takes precedence over `boss`. Each entry requires a unique id slug.
  bosses: z.array(BossWithIdSchema).min(1).optional(),
  botPatterns: RaidIdSchema.optional(),
  players: z.array(PlayerDefSchema).length(ROSTER.length),
  events: z.array(EventSchema),
  waymarks: z.array(WaymarkSchema).optional(),
  crystals: CrystalsSchema,
  optionals: OptionalsSchema,
  botSolvers: BotSolversSchema,
}).superRefine((raid, ctx) => {
  // Validate that boss ids in the bosses list are unique.
  if (raid.bosses) {
    const seenBossIds = new Set<string>();
    raid.bosses.forEach((boss, i) => {
      if (seenBossIds.has(boss.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bosses", i, "id"], message: `duplicate boss id "${boss.id}"` });
      }
      seenBossIds.add(boss.id);
    });
  }
  // Compute the effective set of boss ids for bossId validation.
  const bossIds = raid.bosses ? new Set(raid.bosses.map(b => b.id)) : new Set(["boss"]);
  // Validate that every event bossId references a declared boss.
  raid.events.forEach((event, i) => {
    const bossId = (event as { bossId?: string }).bossId;
    if (bossId !== undefined && !bossIds.has(bossId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", i, "bossId"],
        message: `event bossId "${bossId}" does not match any declared boss id (${[...bossIds].join(", ")})`,
      });
    }
  });
  raid.botSolvers?.generic?.forEach((rule, i) => {
    if (!Array.isArray(rule.frame)) return;
    rule.frame.forEach((ref, j) => {
      const bossId = typeof ref === "object" && "boss" in ref ? ref.boss.id : undefined;
      if (bossId !== undefined && !bossIds.has(bossId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["botSolvers", "generic", i, "frame", j, "boss", "id"],
          message: `solver frame boss id "${bossId}" does not match any declared boss id (${[...bossIds].join(", ")})`,
        });
      }
    });
  });
}).superRefine((raid, ctx) => {
  const eventIds = new Map<string, { type: string; index: number }>();
  raid.events.forEach((event, i) => {
    const prior = eventIds.get(event.id);
    if (prior) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", i, "id"],
        message: `duplicate event id "${event.id}" also used by ${prior.type} at events[${prior.index}]`,
      });
      return;
    }
    eventIds.set(event.id, { type: event.type, index: i });
  });

  raid.optionals?.orderSwap?.groups.forEach((group, groupIndex) => {
    let timing: { t: number; telegraph: number } | undefined;
    group.forEach((id, idIndex) => {
      const event = raid.events.find(e => e.id === id);
      if (!event) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["optionals", "orderSwap", "groups", groupIndex, idIndex],
          message: `orderSwap references unknown event id "${id}"`,
        });
        return;
      }
      if (!("telegraph" in event)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["optionals", "orderSwap", "groups", groupIndex, idIndex],
          message: `orderSwap event "${id}" must have a telegraph`,
        });
        return;
      }
      const current = { t: event.t, telegraph: event.telegraph };
      if (timing === undefined) {
        timing = current;
      } else if (timing.t !== current.t || timing.telegraph !== current.telegraph) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["optionals", "orderSwap", "groups", groupIndex, idIndex],
          message: `orderSwap group ${groupIndex} events must share the same time and telegraph`,
        });
      }
    });
  });

  raid.events.forEach((event, i) => {
    if (event.type !== "tower") return;
    event.resolveEventIds?.forEach((id, j) => {
      const target = eventIds.get(id);
      if (!target) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", i, "resolveEventIds", j],
          message: `tower resolveEventIds references unknown event id "${id}"`,
        });
      } else if (target.type !== "effect_resolver") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", i, "resolveEventIds", j],
          message: `tower resolveEventIds "${id}" must reference an effect_resolver event, not ${target.type}`,
        });
      }
    });
  });

  const seenMarks = new Set<string>();
  raid.waymarks?.forEach((waymark, i) => {
    if (seenMarks.has(waymark.mark)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["waymarks", i],
        message: `duplicate waymark "${waymark.mark}"; each mark may be placed at most once`,
      });
    }
    seenMarks.add(waymark.mark);
  });

  ROSTER.forEach((expected, i) => {
    const player = raid.players[i];
    if (!player) return; // length() already reported the count mismatch
    if (player.id !== expected.id || player.role !== expected.role) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["players", i],
        message: `player ${i} must be "${expected.id}" (${expected.role}); roster order is ${ROSTER.map(r => `${r.id}:${r.role}`).join(", ")}`,
      });
    }
  });

  const playerIds = new Set(raid.players.map(p => p.id));
  raid.events.forEach((event, i) => {
    if (event.type !== "chain") return;
    event.pairs.forEach((pair, j) => {
      for (const id of pair) {
        if (!playerIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["events", i, "pairs", j],
            message: `chain pair references unknown player id "${id}"`,
          });
        }
      }
    });
  });

  raid.events.forEach((event, i) => {
    if (event.type !== "line_link" || !event.target.playerIds) return;
    event.target.playerIds.forEach((id, j) => {
      if (!playerIds.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", i, "target", "playerIds", j],
          message: `line_link target references unknown player id "${id}"`,
        });
      }
    });
  });

  const lineLinkEventsById = new Map<string, { t: number; index: number; groupCount: number }>();
  raid.events.forEach((event, i) => {
    if (event.type !== "line_link") return;
    lineLinkEventsById.set(event.id, {
      t: event.t,
      index: i,
      groupCount: event.target.roleGroups?.length ?? 0,
    });
  });
  raid.events.forEach((event, i) => {
    if (event.type !== "line_link" || event.link === undefined) return;
    const source = lineLinkEventsById.get(event.link);
    if (!source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", i, "link"],
        message: `link references unknown line_link id "${event.link}"`,
      });
    } else if (source.t > event.t || (source.t === event.t && source.index >= i)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", i, "link"],
        message: `linked line_link "${event.link}" must occur earlier, or appear earlier when t is the same`,
      });
    }
    if (event.target.roleGroups?.length !== 2 || (source && source.groupCount !== 2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", i, "link"],
        message: `linked line_link events must both define exactly 2 target.roleGroups so the complement is well-defined`,
      });
    }
  });

  // group events: validate member ids, and that links reference an earlier 2-group event.
  const groupEventsById = new Map<string, { t: number; groupCount: number }>();
  raid.events.forEach(event => {
    if (event.type === "group" || event.type === "effect_select") {
      groupEventsById.set(event.id, { t: event.t, groupCount: event.groups.length });
    }
  });
  raid.events.forEach((event, i) => {
    if (event.type !== "group" && event.type !== "effect_select") return;
    event.groups.forEach((group, g) => {
      group.forEach(id => {
        if (!playerIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["events", i, "groups", g],
            message: `${event.type} references unknown player id "${id}"`,
          });
        }
      });
    });
    if (event.link !== undefined) {
      const source = groupEventsById.get(event.link);
      if (!source) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", i, "link"],
          message: `link references unknown group event id "${event.link}"`,
        });
      } else if (source.t >= event.t) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", i, "link"],
          message: `linked group event "${event.link}" must occur earlier (t < ${event.t})`,
        });
      }
      if (event.groups.length !== 2 || (source && source.groupCount !== 2)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", i, "link"],
          message: `linked group events must have exactly 2 groups so the complement is well-defined`,
        });
      }
    }
  });

  // spread_stack events: every stack-group member id must exist in the roster.
  raid.events.forEach((event, i) => {
    if (event.type !== "spread_stack") return;
    event.stack.groups.forEach((group, g) => {
      group.forEach(id => {
        if (!playerIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["events", i, "stack", "groups", g],
            message: `spread_stack references unknown player id "${id}"`,
          });
        }
      });
    });
  });

  // bait/dash events must reference an earlier `aoe` with deferred:true (the stored cleave).
  const deferredAoeById = new Map<string, { t: number; index: number }>();
  raid.events.forEach((event, i) => {
    if (event.type === "aoe" && event.deferred) deferredAoeById.set(event.id, { t: event.t, index: i });
  });
  raid.events.forEach((event, i) => {
    if (event.type !== "bait" && event.type !== "dash") return;
    const source = deferredAoeById.get(event.link);
    if (!source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", i, "link"],
        message: `${event.type} link "${event.link}" must reference an aoe event with deferred:true`,
      });
    } else if (source.t > event.t || (source.t === event.t && source.index >= i)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events", i, "link"],
        message: `linked stored cleave "${event.link}" must occur earlier than the ${event.type}`,
      });
    }
  });

  // plant combination groups: every declared member id must exist in the roster.
  const plant = raid.optionals?.combinations?.plant;
  if (plant) {
    (["g1", "g2"] as const).forEach(key => {
      plant[key].members.forEach((id, j) => {
        if (!playerIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["optionals", "combinations", "plant", key, "members", j],
            message: `plant ${key} references unknown player id "${id}"`,
          });
        }
      });
    });
  }

  const pairings = raid.optionals?.combinations?.pairings;
  if (pairings) {
    pairings.patterns.forEach((pattern, patternIndex) => {
      const members = new Set<string>();
      pattern.pairs.forEach((pair, pairIndex) => {
        pair.members.forEach((id, memberIndex) => {
          if (!playerIds.has(id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["optionals", "combinations", "pairings", "patterns", patternIndex, "pairs", pairIndex, "members", memberIndex],
              message: `pairing pattern references unknown player id "${id}"`,
            });
          }
          if (members.has(id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["optionals", "combinations", "pairings", "patterns", patternIndex, "pairs", pairIndex, "members", memberIndex],
              message: `pairing pattern assigns player "${id}" more than once`,
            });
          }
          members.add(id);
        });
      });
    });
  }

  const endings = raid.optionals?.combinations?.endings;
  if (endings) {
    if (endings.variants.length !== endings.events.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["optionals", "combinations", "endings", "variants"],
        message: "endings variants length must match events length",
      });
    }
    endings.events.forEach((id, i) => {
      if (!deferredAoeById.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["optionals", "combinations", "endings", "events", i],
          message: `ending event "${id}" must reference an aoe event with deferred:true`,
        });
      }
    });
  }
}).transform(data => {
  const bosses = data.bosses?.map(({ id, pos, aggro, targetable, ...overrides }) => ({
    id,
    pos,
    targetable,
    ...resolveBossIdentity(overrides, isBossRegistryId(id) ? id : DEFAULT_BOSS_ID),
    ...(aggro !== undefined ? { aggro } : {}),
  })) ?? [{
    id: "boss",
    pos: data.boss.pos,
    targetable: true,
    ...resolveBossIdentity(data.boss, data.boss.id ?? DEFAULT_BOSS_ID),
  }];

  return {
    ...data,
    bosses,
  };
});

export const BotPatternsSchema = z.object({
  players: z.record(z.string().min(1), z.array(WaypointSchema)),
  solvers: BotSolversSchema,
});

export type RaidDef = z.infer<typeof RaidSchema>;
export type BotPatternsDef = z.infer<typeof BotPatternsSchema>;
