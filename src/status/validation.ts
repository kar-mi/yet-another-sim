import { z } from "zod";
import { statusTemplate } from "./catalog";
import type { StatusBehaviorKind } from "./types";

export const DamageTypeSchema = z.enum(["physical", "magical", "true"]);
const CircleOrDonutSchema = z.enum(["circle", "donut"]);
const CatalogIdSchema = z.string().refine(ref => statusTemplate(ref) !== undefined, { error: issue => `unknown status ref "${String(issue.input)}"` });

const DirectionSchema = z.preprocess(
  value => typeof value === "object" && value !== null && !Array.isArray(value) && "x" in value && "z" in value
    ? [value.x, value.z]
    : value,
  z.tuple([z.number(), z.number()]),
);

const BEHAVIOR_SCHEMAS = {
  none: z.object({ kind: z.literal("none") }),
  vuln: z.object({ kind: z.literal("vuln"), damageType: z.enum(["physical", "magical"]), multiplier: z.number().positive() }),
  mitigation: z.object({ kind: z.literal("mitigation"), damageType: DamageTypeSchema.optional(), multiplier: z.number().positive() }),
  dot: z.object({ kind: z.literal("dot"), dps: z.number().nonnegative(), condition: z.enum(["always", "moving", "idle"]).default("always") }),
  confusion: z.object({ kind: z.literal("confusion"), damage: z.number().nonnegative(), damageType: DamageTypeSchema, radius: z.number().positive() }),
  sleep: z.object({ kind: z.literal("sleep") }),
  burstSpread: z.object({
    kind: z.literal("burstSpread"),
    radius: z.number().positive().default(3),
    damage: z.number().nonnegative(),
    damageType: DamageTypeSchema,
    knockbackDistance: z.number().nonnegative().default(6),
    selfShape: CircleOrDonutSchema.default("circle"),
    selfInner: z.number().positive().optional(),
    followUp: z.object({
      mode: z.enum(["closest", "furthest"]).default("closest"),
      count: z.number().int().positive().default(2),
      originCrystal: z.enum(["wind", "fire", "water", "earth"]).optional(),
      shape: CircleOrDonutSchema.default("circle"),
      radius: z.number().positive(),
      inner: z.number().positive().optional(),
      damage: z.number().nonnegative(),
      damageType: DamageTypeSchema,
      knockbackDistance: z.number().positive().optional(),
    }).optional(),
  }),
  effectBurst: z.object({
    kind: z.literal("effectBurst"),
    shape: CircleOrDonutSchema,
    radius: z.number().positive(),
    innerRadius: z.number().positive().optional(),
    damage: z.number().nonnegative(),
    damageType: DamageTypeSchema,
  }),
  twister: z.object({
    kind: z.literal("twister"),
    delay: z.number().nonnegative(),
    shownShape: CircleOrDonutSchema,
    hiddenShape: CircleOrDonutSchema,
    radius: z.number().positive(),
    innerRadius: z.number().positive().optional(),
    rng: z.boolean().optional(),
    questionMark: z.boolean().optional(),
    damage: z.number().nonnegative(),
    damageType: DamageTypeSchema,
  }),
  carrierGaze: z.object({
    kind: z.literal("carrierGaze"),
    cone: z.object({ angleDeg: z.number().positive().max(360), length: z.number().positive() }),
    damage: z.number().nonnegative(),
    damageType: DamageTypeSchema,
  }),
  reverseCarrierGaze: z.object({
    kind: z.literal("reverseCarrierGaze"),
    coneHalfAngle: z.number().positive().optional(),
    damage: z.number().nonnegative(),
    damageType: DamageTypeSchema,
  }),
  pairedSpreadStack: z.object({
    kind: z.literal("pairedSpreadStack"),
    key: z.string().min(1),
    role: z.enum(["stack", "spread"]),
    spread: z.object({ radius: z.number().positive(), damage: z.number().nonnegative() }),
    stack: z.object({ radius: z.number().positive(), requiredCount: z.number().int().positive(), damage: z.number().nonnegative() }),
    damageType: DamageTypeSchema,
  }),
  effectCheck: z.object({
    kind: z.literal("effectCheck"),
    compare: z.tuple([z.string().min(1), z.string().min(1)]),
    expect: z.enum(["matches", "differs"]),
    failureDamage: z.number().nonnegative(),
    failureDamageType: DamageTypeSchema,
  }),
  plant: z.object({
    kind: z.literal("plant"),
    direction: z.union([
      DirectionSchema.refine(([x, z]) => x !== 0 || z !== 0, "plant direction must be a non-zero vector"),
      z.literal("option"),
    ]).transform(d => (d === "option" ? [0, 1] : d) as [number, number]),
    distance: z.number().positive(),
    radius: z.number().positive().default(3),
    armDelay: z.number().nonnegative().default(3),
    duration: z.number().positive().default(10),
    tpDelay: z.number().nonnegative().default(0.7),
  }),
  directionalKnockback: z.object({
    kind: z.literal("directionalKnockback"),
    requiredFacing: z.enum(["away", "toward"]),
    distance: z.number().nonnegative(),
    doubledDistance: z.number().nonnegative(),
  }),
  escalating: z.object({
    kind: z.literal("escalating"),
    escalationKey: z.string().min(1),
    escalateTo: CatalogIdSchema.optional(),
    escalateDamage: z.number().nonnegative().optional(),
    escalateDamageType: DamageTypeSchema.default("true"),
  }),
  alternating: z.object({
    kind: z.literal("alternating"),
    alternationKey: z.string().min(1),
    repeatDamage: z.number().nonnegative().optional(),
    repeatDamageType: DamageTypeSchema.default("true"),
    repeatApply: CatalogIdSchema.optional(),
  }),
  expiryDamage: z.object({
    kind: z.literal("expiryDamage"),
    expiryDamage: z.number().nonnegative(),
    expiryDamageType: DamageTypeSchema.default("true"),
    surviveLethal: z.boolean().optional(),
    cleanseAtFullHp: z.boolean().optional(),
  }),
  elementCleanse: z.object({
    kind: z.literal("elementCleanse"),
    elements: z.record(z.string().min(1), CatalogIdSchema),
    expiryDamage: z.number().nonnegative(),
    expiryDamageType: DamageTypeSchema.default("true"),
  }),
  elementVuln: z.object({
    kind: z.literal("elementVuln"),
    mechanic: z.string().min(1),
    multiplier: z.number().positive(),
  }),
  motionCheck: z.object({
    kind: z.literal("motionCheck"),
    required: z.enum(["move", "still"]),
    window: z.number().positive().default(0.5),
    failureDamage: z.number().nonnegative(),
    failureDamageType: DamageTypeSchema.default("true"),
    failureKnockupHeight: z.number().positive(),
  }),
  movementSpeed: z.object({ kind: z.literal("movementSpeed"), multiplier: z.number().positive() }),
  knockbackImmunity: z.object({ kind: z.literal("knockbackImmunity") }),
} satisfies { [K in StatusBehaviorKind]: z.ZodType<{ kind: K }> };

export const STATUS_BEHAVIOR_KINDS = Object.keys(BEHAVIOR_SCHEMAS) as StatusBehaviorKind[];

export const StatusBehaviorSchema = z.discriminatedUnion("kind", [
  BEHAVIOR_SCHEMAS.none,
  BEHAVIOR_SCHEMAS.vuln,
  BEHAVIOR_SCHEMAS.mitigation,
  BEHAVIOR_SCHEMAS.dot,
  BEHAVIOR_SCHEMAS.confusion,
  BEHAVIOR_SCHEMAS.sleep,
  BEHAVIOR_SCHEMAS.burstSpread,
  BEHAVIOR_SCHEMAS.effectBurst,
  BEHAVIOR_SCHEMAS.twister,
  BEHAVIOR_SCHEMAS.carrierGaze,
  BEHAVIOR_SCHEMAS.reverseCarrierGaze,
  BEHAVIOR_SCHEMAS.pairedSpreadStack,
  BEHAVIOR_SCHEMAS.effectCheck,
  BEHAVIOR_SCHEMAS.plant,
  BEHAVIOR_SCHEMAS.directionalKnockback,
  BEHAVIOR_SCHEMAS.escalating,
  BEHAVIOR_SCHEMAS.alternating,
  BEHAVIOR_SCHEMAS.expiryDamage,
  BEHAVIOR_SCHEMAS.elementCleanse,
  BEHAVIOR_SCHEMAS.elementVuln,
  BEHAVIOR_SCHEMAS.motionCheck,
  BEHAVIOR_SCHEMAS.movementSpeed,
  BEHAVIOR_SCHEMAS.knockbackImmunity,
]).superRefine((behavior, ctx) => {
  if (behavior.kind === "escalating" && behavior.escalateTo === undefined && behavior.escalateDamage === undefined) {
    ctx.addIssue({ code: "custom", message: "escalating requires escalateTo or escalateDamage" });
  }
  if (behavior.kind === "burstSpread") {
    if (behavior.selfShape === "donut" && behavior.selfInner === undefined) {
      ctx.addIssue({ code: "custom", path: ["selfInner"], message: "selfInner is required when selfShape is \"donut\"" });
    }
    if (behavior.selfShape === "donut" && behavior.selfInner !== undefined && behavior.selfInner >= behavior.radius) {
      ctx.addIssue({ code: "custom", path: ["selfInner"], message: "selfInner must be less than radius" });
    }
    if (behavior.followUp?.shape === "donut" && behavior.followUp.inner === undefined) {
      ctx.addIssue({ code: "custom", path: ["followUp", "inner"], message: "followUp.inner is required when followUp.shape is \"donut\"" });
    }
    if (behavior.followUp?.shape === "donut" && behavior.followUp.inner !== undefined && behavior.followUp.inner >= behavior.followUp.radius) {
      ctx.addIssue({ code: "custom", path: ["followUp", "inner"], message: "followUp.inner must be less than followUp.radius" });
    }
  }
  if (behavior.kind === "effectBurst" && behavior.shape === "donut"
    && (behavior.innerRadius === undefined || behavior.innerRadius >= behavior.radius)) {
    ctx.addIssue({ code: "custom", path: ["innerRadius"], message: "effectBurst donut needs innerRadius smaller than radius" });
  }
  if (behavior.kind === "twister" && (behavior.shownShape === "donut" || behavior.hiddenShape === "donut")
    && (behavior.innerRadius === undefined || behavior.innerRadius >= behavior.radius)) {
    ctx.addIssue({ code: "custom", path: ["innerRadius"], message: "twister donut needs innerRadius smaller than radius" });
  }
});

const StatusRingSchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().min(1),
});

const StatusCountdownSchema = z.object({
  delay: z.number().nonnegative(),
  slices: z.number().int().positive(),
});

export const STATUS_FIELDS = {
  name: z.string().min(1),
  kind: z.enum(["buff", "debuff"]),
  avoidable: z.boolean().optional(),
  duration: z.number().positive(),
  stacks: z.number().int().positive().optional(),
  visibility: z.enum(["visible", "invisible"]).optional(),
  priority: z.boolean().optional(),
  group: z.string().min(1).optional(),
  showTimer: z.boolean().optional(),
  icon: z.string().min(1).optional(),
  marker: z.string().min(1).max(8).optional(),
  markerIcon: z.string().min(1).optional(),
  markerIconScale: z.number().positive().optional(),
  ring: StatusRingSchema.optional(),
  countdown: StatusCountdownSchema.optional(),
};

export const StatusSpecSchema = z.object({
  ref: CatalogIdSchema,
  ...STATUS_FIELDS,
  behavior: StatusBehaviorSchema,
});
