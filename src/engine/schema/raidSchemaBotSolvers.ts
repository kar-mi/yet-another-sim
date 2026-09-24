import { z } from "zod";
import { DebuffMatchSchema, EventIdSchema, RoleSchema } from "./raidSchemaPrimitives";

const AbsoluteSpotSchema = z.strictObject({ x: z.number(), z: z.number() });
const RelativeSpotSchema = z.strictObject({ r: z.number(), z: z.number() });
const PolarSpotSchema = z.strictObject({ dist: z.number(), angleDeg: z.number() });
const SolverSpotSchema = z.union([AbsoluteSpotSchema, RelativeSpotSchema, PolarSpotSchema]);
const FrameRefSchema = z.union([
  EventIdSchema,
  z.object({ crystal: z.enum(["wind", "fire", "water", "earth"]) }),
  z.object({ boss: z.object({
    id: z.string().min(1).optional(),
    from: z.enum(["facing", "position"]),
  }) }),
  z.object({ blackHoleTether: z.object({
    hazardId: EventIdSchema,
    order: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  }) }),
  z.object({ blackHoleOrb: z.object({
    hazardId: EventIdSchema,
    index: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  }) }),
]);
const GenericSolverFrameSchema = z.union([
  z.literal("matched"),
  z.array(FrameRefSchema).min(1),
]);

const GenericSolverRuleSchema = z.object({
  when: z.object({
    static: z.literal(true).optional(),
    mechanic: z.union([EventIdSchema, z.array(EventIdSchema).min(1)]).optional(),
    selectedEvent: z.union([EventIdSchema, z.array(EventIdSchema).min(1)]).optional(),
    role: z.union([RoleSchema, z.array(RoleSchema).min(1)]).optional(),
    debuff: DebuffMatchSchema.optional(),
    partyDebuff: DebuffMatchSchema.optional(),
    partnerDebuff: DebuffMatchSchema.optional(),
    soaks: z.boolean().optional(),
    plant: z.string().min(1).optional(),
    plantSlot: z.number().int().nonnegative().optional(),
    endingFacing: z.object({ event: EventIdSchema, offset: z.number() }).optional(),
  }),
  startAt: z.number().nonnegative().optional(),
  endAt: z.number().nonnegative().optional(),
  frame: GenericSolverFrameSchema.optional(),
  origin: z.object({ boss: z.string().min(1) }).optional(),
  mirrorLateral: z.boolean().optional(),
  mirrorForward: z.boolean().optional(),
  spots: z.record(z.string().min(1), SolverSpotSchema).optional(),
  spot: SolverSpotSchema.optional(),
  safeSpots: z.array(SolverSpotSchema).min(1).optional(),
  dangerHorizon: z.number().positive().optional(),
  limitCutSpread: z.object({ spots: z.array(z.union([RelativeSpotSchema, PolarSpotSchema])).min(1) }).optional(),
  freeze: z.literal(true).optional(),
  nearestEdge: z.object({ from: FrameRefSchema, avoid: FrameRefSchema, clearance: z.number().positive() }).optional(),
  tetherMidpoint: z.object({
    hazardId: EventIdSchema,
    order: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  }).optional(),
}).superRefine((rule, ctx) => {
  const hasCondition = rule.when.static === true || rule.when.mechanic !== undefined || rule.when.selectedEvent !== undefined || rule.when.debuff !== undefined
    || rule.when.partyDebuff !== undefined || rule.when.partnerDebuff !== undefined || rule.when.plant !== undefined;
  if (!hasCondition) {
    ctx.addIssue({ code: "custom", path: ["when"], message: "rule must have when.static: true or at least one of when.mechanic / when.selectedEvent / when.debuff / when.partyDebuff / when.partnerDebuff / when.plant" });
  }
  if (rule.freeze) {
    if (rule.spot !== undefined || rule.spots !== undefined || rule.safeSpots !== undefined || rule.frame !== undefined
      || rule.limitCutSpread !== undefined || rule.nearestEdge !== undefined || rule.tetherMidpoint !== undefined) {
      ctx.addIssue({ code: "custom", path: ["freeze"], message: "freeze holds the bot at its current position; do not also set spot / spots / frame / limitCutSpread / nearestEdge / tetherMidpoint" });
    }
    return;
  }
  if (rule.nearestEdge !== undefined) {
    if (rule.frame !== undefined || rule.origin !== undefined || rule.spot !== undefined
      || rule.spots !== undefined || rule.safeSpots !== undefined || rule.limitCutSpread !== undefined || rule.tetherMidpoint !== undefined) {
      ctx.addIssue({ code: "custom", path: ["nearestEdge"], message: "nearestEdge returns absolute coords; do not also set frame / origin / spot / spots / limitCutSpread / tetherMidpoint" });
    }
    return;
  }
  if (rule.tetherMidpoint !== undefined) {
    if (rule.limitCutSpread !== undefined) {
      ctx.addIssue({ code: "custom", path: ["tetherMidpoint"], message: "tetherMidpoint cannot be combined with limitCutSpread" });
    }
    if (rule.spot === undefined && rule.spots === undefined) {
      if (rule.frame !== undefined || rule.origin !== undefined) {
        ctx.addIssue({ code: "custom", path: ["tetherMidpoint"], message: "spotless tetherMidpoint returns absolute coords; do not also set frame / origin" });
      }
      return;
    }
  }
  if (rule.limitCutSpread !== undefined) {
    if (rule.when.mechanic === undefined) {
      ctx.addIssue({ code: "custom", path: ["limitCutSpread"], message: "limitCutSpread requires when.mechanic naming the limit cut" });
    }
    if (rule.frame !== undefined || rule.spot !== undefined || rule.spots !== undefined || rule.safeSpots !== undefined) {
      ctx.addIssue({ code: "custom", path: ["limitCutSpread"], message: "limitCutSpread returns absolute coords; do not also set frame / spot / spots" });
    }
    return;
  }
  if ((rule.when.soaks !== undefined || rule.frame === "matched") && rule.when.mechanic === undefined) {
    ctx.addIssue({ code: "custom", path: ["when"], message: "when.soaks and frame: \"matched\" require when.mechanic" });
  }
  if (rule.dangerHorizon !== undefined && (rule.safeSpots === undefined || rule.when.mechanic === undefined)) {
    ctx.addIssue({ code: "custom", path: ["dangerHorizon"], message: "dangerHorizon requires safeSpots and when.mechanic" });
  }
  if (rule.safeSpots !== undefined && (rule.spot !== undefined || rule.spots !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["safeSpots"], message: "safeSpots cannot be combined with spot / spots" });
  }
  if (rule.origin !== undefined && rule.frame === undefined) {
    ctx.addIssue({ code: "custom", path: ["origin"], message: "origin requires a frame" });
  }
  if (rule.mirrorLateral && !Array.isArray(rule.frame)) {
    ctx.addIssue({ code: "custom", path: ["mirrorLateral"], message: "mirrorLateral requires a reference-list frame" });
  }
  if (rule.mirrorForward && !Array.isArray(rule.frame)) {
    ctx.addIssue({ code: "custom", path: ["mirrorForward"], message: "mirrorForward requires a reference-list frame" });
  }
  if (rule.spots === undefined && rule.spot === undefined && rule.safeSpots === undefined) {
    ctx.addIssue({ code: "custom", path: ["spot"], message: "rule must have at least one of spot / spots / safeSpots" });
  }
  const spots = [rule.spot, ...Object.values(rule.spots ?? {}), ...(rule.safeSpots ?? [])]
    .filter((spot): spot is NonNullable<typeof spot> => spot !== undefined);
  const hasInvalidSpot = rule.frame === undefined
    ? spots.some(spot => !("x" in spot))
    : spots.some(spot => !("r" in spot) && !("angleDeg" in spot));
  if (hasInvalidSpot) {
    ctx.addIssue({
      code: "custom",
      path: ["spot"],
      message: rule.frame === undefined
        ? "unframed rule requires absolute { x, z } spots"
        : "frame requires relative { r, z } or polar { dist, angleDeg } spots",
    });
  }
});
const SolverHoldSchema = z.object({
  mechanic: z.union([EventIdSchema, z.array(EventIdSchema).min(1)]),
  duration: z.number().positive(),
});
export const BotSolversSchema = z.object({
  generic: z.array(GenericSolverRuleSchema).optional(),
  holds: z.array(SolverHoldSchema).optional(),
}).optional();
