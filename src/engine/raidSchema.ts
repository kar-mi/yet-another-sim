import { z } from "zod";
import { MAX_PLAYERS, RaidIdSchema } from "../shared/protocol";

const Vec2Schema = z.tuple([z.number(), z.number()]);
const WaypointSchema = z.object({ t: z.number().nonnegative(), pos: Vec2Schema });

const ZoneShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circle"), center: Vec2Schema, radius: z.number().positive() }),
  z.object({ kind: z.literal("rect"), center: Vec2Schema, width: z.number().positive(), height: z.number().positive() }),
  z.object({ kind: z.literal("polygon"), vertices: z.array(Vec2Schema).min(3) }),
]);

const AOEShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circle"), center: Vec2Schema, radius: z.number().positive() }),
  z.object({ kind: z.literal("donut"), center: Vec2Schema, inner: z.number().nonnegative(), outer: z.number().positive() }),
  z.object({ kind: z.literal("cone"), origin: Vec2Schema, direction: Vec2Schema, angleDeg: z.number().positive(), length: z.number().positive() }),
  z.object({ kind: z.literal("rect"), origin: Vec2Schema, direction: Vec2Schema, width: z.number().positive(), length: z.number().positive() }),
]).superRefine((shape, ctx) => {
  if (shape.kind === "donut" && shape.inner >= shape.outer) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "donut inner must be less than outer" });
  }
  if (shape.kind === "cone" && shape.direction[0] === 0 && shape.direction[1] === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cone direction must be a non-zero vector" });
  }
});

const AOEEventSchema = z.object({
  type: z.literal("aoe").default("aoe"),
  t: z.number().nonnegative(),
  name: z.string().min(1),
  telegraph: z.number().positive(),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  shape: AOEShapeSchema,
  applyEffect: z.object({
    name: z.string().min(1),
    kind: z.enum(["buff", "debuff"]),
    duration: z.number().positive(),
    behavior: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }),
      z.object({ kind: z.literal("vuln"), damageType: z.enum(["physical", "magical"]), multiplier: z.number().positive() }),
      z.object({ kind: z.literal("pyretic"), dps: z.number().nonnegative() }),
      z.object({ kind: z.literal("freeze"), dps: z.number().nonnegative() }),
    ]),
  }).optional(),
  showCastBar: z.boolean().optional(),
});

const TetherSourceEventSchema = z.object({
  type: z.literal("tether_source"),
  t: z.number().nonnegative(),
  name: z.string().min(1),
  pos: Vec2Schema,
  finalizeAfter: z.number().positive(),
  tetherKind: z.enum(["buff", "debuff"]),
  buffName: z.string().min(1),
  behavior: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({ kind: z.literal("vuln"), damageType: z.enum(["physical", "magical"]), multiplier: z.number().positive() }),
    z.object({ kind: z.literal("pyretic"), dps: z.number().nonnegative() }),
    z.object({ kind: z.literal("freeze"), dps: z.number().nonnegative() }),
  ]).default({ kind: "none" }),
  effectDuration: z.number().positive().default(15),
});

export const EventSchema = z.union([TetherSourceEventSchema, AOEEventSchema]);

const PlayerDefSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["tank", "healer", "dps"]),
  control: z.enum(["human", "bot"]).default("human"),
  spawn: Vec2Schema,
  pattern: z.array(WaypointSchema).optional(),
});

export const RaidSchema = z.object({
  name: z.string().min(1),
  arena: z.object({ zones: z.array(ZoneShapeSchema).min(1) }),
  duration: z.number().positive(),
  botPatterns: RaidIdSchema.optional(),
  players: z.array(PlayerDefSchema).min(1).max(MAX_PLAYERS),
  events: z.array(EventSchema),
});

export const BotPatternsSchema = z.object({
  players: z.record(z.string().min(1), z.array(WaypointSchema)),
});

export type RaidDef = z.infer<typeof RaidSchema>;
export type BotPatternsDef = z.infer<typeof BotPatternsSchema>;
