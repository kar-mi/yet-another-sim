import { z } from "zod";
import { DebuffMatchSchema, EventIdSchema, RoleSchema } from "./raidSchemaPrimitives";

const AbsoluteSpotSchema = z.strictObject({ x: z.number(), z: z.number() });
const RelativeSpotSchema = z.strictObject({ r: z.number(), z: z.number() });
const PolarSpotSchema = z.strictObject({ dist: z.number(), angleDeg: z.number() });
const SolverSpotSchema = z.union([AbsoluteSpotSchema, RelativeSpotSchema, PolarSpotSchema]);
// A single positioned reference summed into a frame's north vector: a positioned event id (tower),
// a resolved elemental crystal, or a boss (its facing direction or position).
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
    static: z.literal(true).optional(), // explicit always-active fallback
    // segment-prefix match on a resolved mechanic id OR an exact match on one of its labels;
    // an array requires all listed mechanics at once
    mechanic: z.union([EventIdSchema, z.array(EventIdSchema).min(1)]).optional(),
    role: z.union([RoleSchema, z.array(RoleSchema).min(1)]).optional(),
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
  origin: z.object({ boss: z.string().min(1) }).optional(),
  mirrorLateral: z.boolean().optional(),
  mirrorForward: z.boolean().optional(),
  spots: z.record(z.string().min(1), SolverSpotSchema).optional(),
  spot: SolverSpotSchema.optional(),
  // Limit Cut ring placement; `spots[n-1]` (relative/polar) is rotated by the basis of the limit cut
  // named in when.mechanic (see GenericSolverRule.limitCutSpread).
  limitCutSpread: z.object({ spots: z.array(z.union([RelativeSpotSchema, PolarSpotSchema])).min(1) }).optional(),
  // Holds the bot at its current position while the rule is active; mutually exclusive with
  // spot/spots/frame/limitCutSpread since there's no target to compute.
  freeze: z.literal(true).optional(),
  // Nearest arena-edge point (to `from`) that stays `clearance` clear of the `avoid` line axis; see
  // GenericSolverRule.nearestEdge. Replaces (and forbids) the usual frame/spot/spots placement.
  nearestEdge: z.object({ from: FrameRefSchema, avoid: FrameRefSchema, clearance: z.number().positive() }).optional(),
  tetherMidpoint: z.object({
    hazardId: EventIdSchema,
    order: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  }).optional(),
}).superRefine((rule, ctx) => {
  const hasCondition = rule.when.static === true || rule.when.mechanic !== undefined || rule.when.debuff !== undefined
    || rule.when.partyDebuff !== undefined || rule.when.partnerDebuff !== undefined || rule.when.plant !== undefined;
  if (!hasCondition) {
    ctx.addIssue({ code: "custom", path: ["when"], message: "rule must have when.static: true or at least one of when.mechanic / when.debuff / when.partyDebuff / when.partnerDebuff / when.plant" });
  }
  // freeze holds the bot wherever it already is, so it must not also set a computed target.
  if (rule.freeze) {
    if (rule.spot !== undefined || rule.spots !== undefined || rule.frame !== undefined
      || rule.limitCutSpread !== undefined || rule.nearestEdge !== undefined || rule.tetherMidpoint !== undefined) {
      ctx.addIssue({ code: "custom", path: ["freeze"], message: "freeze holds the bot at its current position; do not also set spot / spots / frame / limitCutSpread / nearestEdge / tetherMidpoint" });
    }
    return;
  }
  // nearestEdge computes an absolute edge target from `from`/`avoid`, so it replaces (and forbids)
  // the usual frame/spot/spots placement, like limitCutSpread and freeze.
  if (rule.nearestEdge !== undefined) {
    if (rule.frame !== undefined || rule.origin !== undefined || rule.spot !== undefined
      || rule.spots !== undefined || rule.limitCutSpread !== undefined || rule.tetherMidpoint !== undefined) {
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
  // limitCutSpread computes absolute coords from each bot's number; it sources its rotation basis
  // from the limit cut named by when.mechanic, and replaces (and forbids) the usual frame/spot/spots
  // placement, so skip those requirements once it's validated.
  if (rule.limitCutSpread !== undefined) {
    if (rule.when.mechanic === undefined) {
      ctx.addIssue({ code: "custom", path: ["limitCutSpread"], message: "limitCutSpread requires when.mechanic naming the limit cut" });
    }
    if (rule.frame !== undefined || rule.spot !== undefined || rule.spots !== undefined) {
      ctx.addIssue({ code: "custom", path: ["limitCutSpread"], message: "limitCutSpread returns absolute coords; do not also set frame / spot / spots" });
    }
    return;
  }
  if ((rule.when.soaks !== undefined || rule.frame === "matched") && rule.when.mechanic === undefined) {
    ctx.addIssue({ code: "custom", path: ["when"], message: "when.soaks and frame: \"matched\" require when.mechanic" });
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
  if (rule.spots === undefined && rule.spot === undefined) {
    ctx.addIssue({ code: "custom", path: ["spot"], message: "rule must have at least one of spot / spots" });
  }
  const spots = [rule.spot, ...Object.values(rule.spots ?? {})]
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
  // id-prefix or label match (same matching as when.mechanic); array matches any listed mechanic
  mechanic: z.union([EventIdSchema, z.array(EventIdSchema).min(1)]),
  duration: z.number().positive(), // seconds bots hold position after a matching mechanic resolves
});
export const BotSolversSchema = z.object({
  generic: z.array(GenericSolverRuleSchema).optional(),
  holds: z.array(SolverHoldSchema).optional(),
}).optional();
