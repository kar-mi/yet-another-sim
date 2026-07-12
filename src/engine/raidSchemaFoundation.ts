import { z } from "zod";
import { EventIdSchema, RoleSchema, Vec2Schema } from "./raidSchemaPrimitives";
import { resolveEffectRef } from "./status/registry";
import { DEBUFF_REGISTRY } from "./status/debuffs";

export const WaymarkSchema = z.object({
  mark: z.enum(["A", "B", "C", "D", "1", "2", "3", "4"]),
  pos: Vec2Schema,
});

const CrystalSpawnSchema = z.object({
  kind: z.literal("single").default("single"),
  element: z.enum(["wind", "fire", "water", "earth"]),
  pos: Vec2Schema,
  spawnAt: z.number().nonnegative().optional(),
});
const CrystalRotationSchema = z.object({
  kind: z.literal("rotatingTrio"),
  spots: z.array(Vec2Schema).length(4),
  spawnAt: z.number().nonnegative().optional(),
});
const CrystalEntrySchema = z.preprocess(
  value => typeof value === "object" && value !== null && !Array.isArray(value) && !("kind" in value)
    ? { kind: "single", ...value }
    : value,
  z.discriminatedUnion("kind", [CrystalSpawnSchema, CrystalRotationSchema]),
);
export const CrystalsSchema = z.array(CrystalEntrySchema).optional();

export const FloorPlanSchema = z.enum(["squares", "dmu-p1", "dmu-p2"]).default("squares");

export const ZoneShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circle"), center: Vec2Schema, radius: z.number().positive() }),
  z.object({ kind: z.literal("rect"), center: Vec2Schema, width: z.number().positive(), height: z.number().positive() }),
  z.object({ kind: z.literal("polygon"), vertices: z.array(Vec2Schema).min(3) }),
]);

export const AOEShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circle"), center: Vec2Schema, radius: z.number().positive() }),
  z.object({ kind: z.literal("donut"), center: Vec2Schema, inner: z.number().nonnegative(), outer: z.number().positive() }),
  z.object({ kind: z.literal("cone"), origin: Vec2Schema.default([0, 0]), direction: Vec2Schema.default([0, 1]), angleDeg: z.number().positive(), length: z.number().positive() }),
  z.object({ kind: z.literal("rect"), origin: Vec2Schema.default([0, 0]), direction: Vec2Schema.default([0, 1]), width: z.number().positive(), length: z.number().positive() }),
]).superRefine((shape, ctx) => {
  if (shape.kind === "donut" && shape.inner >= shape.outer) {
    ctx.addIssue({ code: "custom", message: "donut inner must be less than outer" });
  }
  if (shape.kind === "cone" && shape.direction[0] === 0 && shape.direction[1] === 0) {
    ctx.addIssue({ code: "custom", message: "cone direction must be a non-zero vector" });
  }
});

const EffectBehaviorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("vuln"), damageType: z.enum(["physical", "magical"]), multiplier: z.number().positive() }),
  z.object({ kind: z.literal("mitigation"), damageType: z.enum(["physical", "magical", "true"]).optional(), multiplier: z.number().positive() }),
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
      originCrystal: z.enum(["wind", "fire", "water", "earth"]).optional(),
      shape: z.enum(["circle", "donut"]).default("circle"),
      radius: z.number().positive(),
      inner: z.number().positive().optional(),
      damage: z.number().nonnegative(),
      damageType: z.enum(["physical", "magical", "true"]),
      knockbackDistance: z.number().positive().optional(),
    }).optional(),
  }),
  z.object({
    kind: z.literal("effectBurst"),
    shape: z.enum(["circle", "donut"]),
    radius: z.number().positive(),
    innerRadius: z.number().positive().optional(),
    damage: z.number().nonnegative(),
    damageType: z.enum(["physical", "magical", "true"]),
  }),
  z.object({
    kind: z.literal("twister"),
    delay: z.number().nonnegative(),
    shownShape: z.enum(["circle", "donut"]),
    hiddenShape: z.enum(["circle", "donut"]),
    radius: z.number().positive(),
    innerRadius: z.number().positive().optional(),
    rng: z.boolean().optional(),
    questionMark: z.boolean().optional(),
    damage: z.number().nonnegative(),
    damageType: z.enum(["physical", "magical", "true"]),
  }),
  z.object({
    kind: z.literal("carrierGaze"),
    cone: z.object({ angleDeg: z.number().positive().max(360), length: z.number().positive() }),
    damage: z.number().nonnegative(),
    damageType: z.enum(["physical", "magical", "true"]),
  }),
  z.object({
    kind: z.literal("reverseCarrierGaze"),
    coneHalfAngle: z.number().positive().optional(),
    damage: z.number().nonnegative(),
    damageType: z.enum(["physical", "magical", "true"]),
  }),
  z.object({
    kind: z.literal("pairedSpreadStack"),
    key: z.string().min(1),
    role: z.enum(["stack", "spread"]),
    spread: z.object({ radius: z.number().positive(), damage: z.number().nonnegative() }),
    stack: z.object({ radius: z.number().positive(), requiredCount: z.number().int().positive(), damage: z.number().nonnegative() }),
    damageType: z.enum(["physical", "magical", "true"]),
  }),
  z.object({
    kind: z.literal("effectCheck"),
    compare: z.tuple([z.string().min(1), z.string().min(1)]),
    expect: z.enum(["matches", "differs"]),
    failureDamage: z.number().nonnegative(),
    failureDamageType: z.enum(["physical", "magical", "true"]),
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
    kind: z.literal("escalating"),
    escalationKey: z.string().min(1),
    escalateTo: z.string().refine(ref => ref in DEBUFF_REGISTRY, "escalateTo must be a key in DEBUFF_REGISTRY").optional(),
    escalateDamage: z.number().nonnegative().optional(),
    escalateDamageType: z.enum(["physical", "magical", "true"]).default("true"),
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
    kind: z.literal("motionCheck"),
    required: z.enum(["move", "still"]),
    window: z.number().positive().default(0.5),
    failureDamage: z.number().nonnegative(),
    failureDamageType: z.enum(["physical", "magical", "true"]).default("true"),
    failureKnockupHeight: z.number().positive(),
  }),
  z.object({
    kind: z.literal("assignment"),
    expiryDamage: z.number().nonnegative(),
    expiryDamageType: z.enum(["physical", "magical", "true"]).default("true"),
  }),
]).superRefine((b, ctx) => {
  if (b.kind === "escalating") {
    if (b.escalateTo === undefined && b.escalateDamage === undefined) {
      ctx.addIssue({ code: "custom", message: "escalating requires escalateTo or escalateDamage" });
    }
    return;
  }
  if (b.kind === "burstSpread" && b.selfShape === "donut" && b.selfInner === undefined) {
    ctx.addIssue({ code: "custom", path: ["selfInner"], message: "selfInner is required when selfShape is \"donut\"" });
  }
  if (b.kind === "burstSpread" && b.selfShape === "donut" && b.selfInner !== undefined && b.selfInner >= b.radius) {
    ctx.addIssue({ code: "custom", path: ["selfInner"], message: "selfInner must be less than radius" });
  }
  if (b.kind === "burstSpread" && b.followUp?.shape === "donut" && b.followUp.inner === undefined) {
    ctx.addIssue({ code: "custom", path: ["followUp", "inner"], message: "followUp.inner is required when followUp.shape is \"donut\"" });
  }
  if (b.kind === "burstSpread" && b.followUp?.shape === "donut" && b.followUp.inner !== undefined && b.followUp.inner >= b.followUp.radius) {
    ctx.addIssue({ code: "custom", path: ["followUp", "inner"], message: "followUp.inner must be less than followUp.radius" });
  }
  if (b.kind === "effectBurst" && b.shape === "donut"
    && (b.innerRadius === undefined || b.innerRadius >= b.radius)) {
    ctx.addIssue({ code: "custom", path: ["innerRadius"], message: "effectBurst donut needs innerRadius smaller than radius" });
  }
  if (b.kind === "twister" && (b.shownShape === "donut" || b.hiddenShape === "donut")
    && (b.innerRadius === undefined || b.innerRadius >= b.radius)) {
    ctx.addIssue({ code: "custom", path: ["innerRadius"], message: "twister donut needs innerRadius smaller than radius" });
  }
});

const InlineApplyEffectSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["buff", "debuff"]),
  duration: z.number().positive(),
  stacks: z.number().int().positive().optional(),
  behavior: EffectBehaviorSchema,
  visibility: z.enum(["visible", "invisible"]).optional(),
  priority: z.boolean().optional(),
  group: z.string().min(1).optional(),
  showTimer: z.boolean().optional(),
  icon: z.string().min(1).optional(),   // HUD icon filename, served from /static/debuffs/
  marker: z.string().min(1).max(8).optional(), // short above-head marker shown while active
  markerIcon: z.string().min(1).optional(), // above-head marker image filename, served from /static/head_markers/
  markerIconScale: z.number().positive().optional(), // per-icon size multiplier (default 4)
});

const EffectRefSchema = z.object({
  ref: z.string().regex(/^[a-z][a-z0-9_]*$/, "status ref must be a snake_case id"),
  name: z.string().min(1).optional(),
  kind: z.enum(["buff", "debuff"]).optional(),
  duration: z.number().positive().optional(),
  stacks: z.number().int().positive().optional(),
  behavior: z.record(z.string(), z.unknown()).optional(),
  visibility: z.enum(["visible", "invisible"]).optional(),
  priority: z.boolean().optional(),
  group: z.string().min(1).optional(),
  showTimer: z.boolean().optional(),
  icon: z.string().min(1).optional(),
  marker: z.string().min(1).max(8).optional(),
  markerIcon: z.string().min(1).optional(),
  markerIconScale: z.number().positive().optional(),
});

export const ApplyEffectSchema = z.union([InlineApplyEffectSchema, EffectRefSchema]).transform((effect, ctx) => {
  if (!("ref" in effect)) {
    if (effect.kind === "debuff") {
      ctx.addIssue({ code: "custom", path: ["kind"], message: `inline debuffs are not allowed; add "${effect.name}" to DEBUFF_REGISTRY and use \`ref\` instead` });
      return z.NEVER;
    }
    return effect;
  }
  const resolved = resolveEffectRef(effect);
  if (!resolved) {
    ctx.addIssue({ code: "custom", path: ["ref"], message: `unknown status ref "${effect.ref}"` });
    return z.NEVER;
  }
  if (resolved.kind === "debuff" && !(effect.ref in DEBUFF_REGISTRY)) {
    ctx.addIssue({ code: "custom", path: ["ref"], message: `debuff ref "${effect.ref}" must be defined in DEBUFF_REGISTRY` });
    return z.NEVER;
  }
  const parsed = InlineApplyEffectSchema.safeParse(resolved);
  if (!parsed.success) {
    ctx.addIssue({ code: "custom", message: parsed.error.message });
    return z.NEVER;
  }
  return parsed.data;
});

export const ApplyEffectsSchema = z.object({
  effects: z.array(ApplyEffectSchema).min(1),
  order: z.enum(["listed", "shuffle", "shuffleBalanced"]).default("listed"),
});

export const KnockbackSchema = z.object({
  distance: z.number().positive(),
  height: z.number().nonnegative().default(0), // 0 = horizontal knockback; >0 = knockup arc
  origin: Vec2Schema.optional(),               // defaults to the AOE shape's center/origin
});
