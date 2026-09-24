import { z } from "zod";
import { StatusBundleSchema, StatusIdSchema, StatusRefSchema } from "@status/schema";
import { ElementGlyphKindSchema, EventIdSchema, RoleSchema, Vec2Schema } from "./raidSchemaPrimitives";
import { AOEShapeSchema, KnockbackSchema } from "./raidSchemaFoundation";
import { VfxSchema } from "@effects/schema";

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
  labels: z.array(z.string().min(1)).optional(),
  group: z.string().min(1).optional(),
  telegraph: z.number().positive(),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  avoidable: z.boolean().optional(),
  shape: AOEShapeSchema,
  applyEffect: StatusRefSchema.optional(),
  applyEffects: StatusBundleSchema.optional(),
  knockback: KnockbackSchema.optional(),
  anchor: z.literal("boss").optional(),
  directionFrom: z.literal("bossFacing").optional(),
  directionOffset: z.number().optional(),
  sideOrbAfter: EventIdSchema.optional(),
  aimAtPlayer: z.string().min(1).optional(),
  lockFacing: z.boolean().default(true),
  bossStationary: z.boolean().default(true),
  deferred: z.boolean().default(false),
  requireFullHp: z.boolean().default(false),
  onlyCarriers: z.boolean().optional(),
  players: z.array(z.string().min(1)).optional(),
  positional: z.object({
    center: z.number(),
    width: z.number().positive().max(Math.PI * 2),
  }).optional(),
  showCastBar: z.boolean().default(false),
  showTelegraph: z.boolean().default(true),
  telegraphMode: TelegraphModeSchema.default("cast"),
  linger: z.number().positive().optional(),
  bossRelativeCenter: BossRelativeCenterSchema.optional(),
  flashBeforeResolve: z.object({
    lead: z.number().positive(),
    color: z.string().optional(),
  }).optional(),
  color: z.string().min(1).optional(),
  outline: z.boolean().optional(),
  telegraphAlpha: z.number().min(0).max(1).optional(),
  glyph: z.object({ at: Vec2Schema, kind: ElementGlyphKindSchema.optional() }).optional(),
  ring: z.object({ center: Vec2Schema, radius: z.number().positive(), kind: ElementGlyphKindSchema.optional() }).optional(),
  element: ElementGlyphKindSchema.optional(),
  vfx: VfxSchema.optional(),
  mover: z.object({ from: Vec2Schema, departAt: z.number().nonnegative(), scale: z.number().positive().optional(), sprite: z.boolean().optional() }).optional(),
  bossId: z.string().min(1).optional(),
});

const TargetedEventSchema = z.object({
  type: z.literal("targeted"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  labels: z.array(z.string().min(1)).optional(),
  group: z.string().min(1).optional(),
  targetMode: z.enum(["closest", "furthest", "aggro"]),
  role: RoleSchema.optional(),
  count: z.number().int().positive().optional(),
  radius: z.number().positive(),
  telegraph: z.number().positive(),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  avoidable: z.boolean().optional(),
  applyEffect: StatusRefSchema.optional(),
  showCastBar: z.boolean().default(false),
  showTelegraph: z.boolean().default(true),
  telegraphMode: TelegraphModeSchema.default("cast"),
  color: z.string().min(1).optional(),
  bossId: z.string().min(1).optional(),
});

const BaitEventSchema = z.object({
  type: z.literal("bait"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  labels: z.array(z.string().min(1)).optional(),
  group: z.string().min(1).optional(),
  targetMode: z.enum(["random", "closest", "furthest"]),
  role: RoleSchema.optional(),
  telegraph: z.number().positive(),
  link: z.string().min(1),
  directionOffsetByEffect: z.record(z.string().min(1), z.number()).optional(),
  showCastBar: z.boolean().default(false),
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
  showCastBar: z.boolean().default(false),
});

const TetherSourceEventSchema = z.object({
  type: z.literal("tether_source"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  pos: Vec2Schema.optional(),
  fromBlackHoleOrb: z.object({
    hazardId: EventIdSchema,
    order: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  }).optional(),
  finalizeAfter: z.number().positive(),
  fireOffsets: z.array(z.number().nonnegative()).min(1).optional(),
  despawnAfter: z.number().positive().optional(),
  tetherKind: z.enum(["buff", "debuff"]),
  buffName: z.string().min(1),
  applyEffect: StatusRefSchema.optional(),
  showSource: z.boolean().default(true),
  beam: z.object({
    width: z.number().positive(),
    length: z.number().positive(),
    damage: z.number().nonnegative(),
    damageType: z.enum(["physical", "magical", "true"]).default("true"),
    avoidable: z.boolean().optional(),
    applyEffect: StatusRefSchema.optional(),
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
  rng: z.boolean().default(false),
  link: z.string().min(1).optional(),
  target: LineLinkTargetSchema,
  hiddenDebuff: StatusIdSchema("debuff"),
  applyEffect: StatusRefSchema.optional(),
  knockback: KnockbackSchema.optional(),
  visual: LineLinkVisualSchema.optional(),
});

const TowerVisualSchema = z.object({
  pillar: z.boolean().optional(),
  countCircles: z.boolean().optional(),
  fallingCylinder: z.boolean().optional(),
  fallingObject: z.enum(["cylinder", "sphere", "box"]).optional(),
  groundStyle: z.enum(["standard", "tank"]).optional(),
  cylinderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  cylinderThickness: z.number().positive().optional(),
  fallingObjectAlpha: z.number().min(0).max(1).optional(),
});

const TowerEventSchema = z.object({
  type: z.literal("tower"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  labels: z.array(z.string().min(1)).optional(),
  group: z.string().min(1).optional(),
  telegraph: z.number().positive(),
  pos: Vec2Schema,
  radius: z.number().positive(),
  requiredCount: z.number().int().positive().default(1),
  requiredRoles: z.array(RoleSchema).min(1).optional(),
  wrongRoleLethal: z.boolean().default(false),
  failureDamage: z.number().nonnegative(),
  failureDamageType: z.enum(["physical", "magical", "true"]),
  avoidable: z.boolean().optional(),

  applyEffect: StatusRefSchema.optional(),
  consumeEffect: z.object({ effectName: z.string().min(1), stacks: z.number().int().positive().default(1) }).optional(),
  knockback: KnockbackSchema.optional(),
  resolveEventIds: z.array(EventIdSchema).optional(),
  visual: TowerVisualSchema.optional(),
});

const EffectResolverActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("spread"),
    radius: z.number().positive(),
    damage: z.number().nonnegative(),
    damageType: z.enum(["physical", "magical", "true"]),
    avoidable: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("stack"),
    radius: z.number().positive(),
    requiredCount: z.number().int().positive().default(1),
    damage: z.number().nonnegative(),
    damageType: z.enum(["physical", "magical", "true"]),
    avoidable: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("cone_nearest"),
    angleDeg: z.number().positive().max(360),
    length: z.number().positive(),
    damage: z.number().nonnegative(),
    damageType: z.enum(["physical", "magical", "true"]),
    avoidable: z.boolean().optional(),
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
  pairs: z.array(z.tuple([z.string().min(1), z.string().min(1)])).min(1),
  telegraph: z.number().positive(),
  breakWindow: z.number().positive(),
  breakDistance: z.number().positive(),
  breakDamage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  avoidable: z.boolean().optional(),
  debuff: StatusIdSchema("debuff"),
  showCastBar: z.boolean().default(false),
});

const GroupEventSchema = z.object({
  type: z.literal("group"),
  time: z.number().nonnegative(),
  name: z.string().min(1),
  id: EventIdSchema,
  groups: z.array(z.array(z.string().min(1)).min(1)).min(1),
  rng: z.boolean().default(false),
  link: z.string().min(1).optional(),
  telegraph: z.number().positive(),
  radius: z.number().positive(),
  requiredCount: z.number().int().positive().default(1),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  avoidable: z.boolean().optional(),

  applyEffect: StatusRefSchema.optional(),
  showCastBar: z.boolean().default(false),
  showMarker: z.boolean().default(true),
  showTelegraph: z.boolean().default(true),
  color: z.string().min(1).optional(),
});

const EffectSelectEventSchema = z.object({
  type: z.literal("effect_select"),
  time: z.number().nonnegative(),
  name: z.string().min(1),
  id: EventIdSchema,
  groups: z.array(z.array(z.string().min(1)).min(1)).min(1),
  rng: z.boolean().default(false),
  link: z.string().min(1).optional(),
  applyEffect: StatusRefSchema,
});

const ApplyEffectEventSchema = z.object({
  type: z.literal("apply_effect"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  role: RoleSchema.optional(),
  players: z.array(z.string().min(1)).min(1).optional(),
  count: z.number().int().positive().optional(),
  assignGroup: z.string().min(1).optional(),
  rng: z.boolean().default(false),
  applyEffect: StatusRefSchema.optional(),
  applyEffectChoices: z.tuple([StatusRefSchema, StatusRefSchema]).optional(),
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
  telegraph: z.number().positive(),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  avoidable: z.boolean().optional(),
  shownShapes: z.array(AOEShapeSchema).min(1),
  hiddenShapes: z.array(AOEShapeSchema).min(1),
  shownShapesB: z.array(AOEShapeSchema).min(1).optional(),
  hiddenShapesB: z.array(AOEShapeSchema).min(1).optional(),
  variantRng: z.boolean().default(false),
  ringColor: z.string().optional(),
  ringHeight: z.number().optional(),
  telegraphAlpha: z.number().min(0).max(1).optional(),
  color: z.string().min(1).optional(),
  rng: z.boolean().default(false),
  questionMark: z.boolean().optional(),
  applyEffect: StatusRefSchema.optional(),
  knockback: KnockbackSchema.optional(),
  showCastBar: z.boolean().default(false),
}).superRefine((ev, ctx) => {
  if (ev.variantRng && (!ev.shownShapesB || !ev.hiddenShapesB)) {
    ctx.addIssue({ code: "custom", message: "variantRng requires both shownShapesB and hiddenShapesB" });
  }
});

const SpreadStackEventSchema = z.object({
  type: z.literal("spread_stack"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  telegraph: z.number().positive(),
  shown: z.enum(["spread", "stack", "random"]),
  rng: z.boolean().default(false),
  questionMark: z.boolean().optional(),
  damageType: z.enum(["physical", "magical", "true"]),
  spread: z.object({
    radius: z.number().positive(),
    damage: z.number().nonnegative(),
    avoidable: z.boolean().optional(),
  }),
  stack: z.object({
    groups: z.array(z.array(z.string().min(1)).min(1)).min(1),
    radius: z.number().positive(),
    requiredCount: z.number().int().positive().default(1),
    damage: z.number().nonnegative(),
    avoidable: z.boolean().optional(),
  }),
  stackCarriers: z.string().min(1).optional(),
  spreadCarriers: z.string().min(1).optional(),
  ringColor: z.string().optional(),
  ringHeight: z.number().optional(),
  showCastBar: z.boolean().default(false),
}).superRefine((event, ctx) => {
  if ((event.stackCarriers === undefined) !== (event.spreadCarriers === undefined)) {
    ctx.addIssue({ code: "custom", message: "stackCarriers and spreadCarriers must be provided together" });
  }
});

const GazeVisualSchema = z.object({
  width: z.number().positive().default(4),
  height: z.number().positive().default(3),
  depth: z.number().positive().default(0.4),
});

const GazeEventSchema = z.object({
  type: z.literal("gaze"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  telegraph: z.number().positive(),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  avoidable: z.boolean().optional(),
  pos: Vec2Schema.optional(),
  carriers: z.string().min(1).optional(),
  carrierCone: z.object({ angleDeg: z.number().positive().max(360), length: z.number().positive() }).optional(),
  reverse: z.boolean().default(false),
  rng: z.boolean().default(false),
  coneHalfAngle: z.number().positive().optional(),
  applyEffect: StatusRefSchema.optional(),
  knockback: KnockbackSchema.optional(),
  showCastBar: z.boolean().default(false),
  visual: GazeVisualSchema.optional(),
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
  pos: Vec2Schema,
  radius: z.number().positive(),
  direction: Vec2Schema,
  distance: z.number().positive(),
  duration: z.number().positive(),
  preDelay: z.number().nonnegative().default(0.3),
  postDelay: z.number().nonnegative().default(0.3),
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
    orderFrom: EventIdSchema.optional(),
  }).optional(),
  radius: z.number().positive(),
  duration: z.number().positive(),
  armingTime: z.number().nonnegative().default(0),
  applyEffect: StatusRefSchema,
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
  avoidable: z.boolean().optional(),

  applyEffect: StatusRefSchema.optional(),
  hitInterval: z.number().positive().optional(),
  teleportBoss: z.string().min(1).optional(),
  hideBoss: z.string().min(1).optional(),
  visual: z.enum(["step", "line"]).default("step"),
}).superRefine((ev, ctx) => {
  if (ev.from[0] === ev.to[0] && ev.from[1] === ev.to[1]) {
    ctx.addIssue({ code: "custom", path: ["to"], message: "divebomb endpoints must be distinct" });
  }
});

const BossTeleportEventSchema = z.object({
  facing: z.number().optional(),
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
  telegraph: z.number().positive(),
  effectName: z.string().min(1),
  radius: z.number().positive(),
  innerRadius: z.number().positive().optional(),
  shownShape: z.enum(["circle", "donut"]).default("circle"),
  hiddenShape: z.enum(["circle", "donut"]).default("circle"),
  rng: z.boolean().default(false),
  questionMark: z.boolean().optional(),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  avoidable: z.boolean().optional(),
  applyEffect: StatusRefSchema.optional(),
  knockback: KnockbackSchema.optional(),
  showCastBar: z.boolean().default(false),
  showTelegraph: z.boolean().default(true),
  telegraphMode: TelegraphModeSchema.default("cast"),
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
  avoidable: z.boolean().optional(),
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

const ReassignChargeSchema = z.object({
  kind: z.string().min(1),
  effect: StatusRefSchema,
  marker: StatusRefSchema.optional(),
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

const LimitCutEventSchema = z.object({
  type: z.literal("limit_cut"),
  id: EventIdSchema,
  time: z.number().nonnegative(),
  name: z.string().min(1),
  effect: StatusRefSchema,
  players: z.array(z.string().min(1)).min(1).optional(),
  role: RoleSchema.optional(),
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
