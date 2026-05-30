import { z } from "zod";
import { ROSTER, RaidIdSchema } from "../shared/protocol";

const Vec2Schema = z.tuple([z.number(), z.number()]);
const WaypointSchema = z.object({ t: z.number().nonnegative(), pos: Vec2Schema });

const WaymarkSchema = z.object({
  mark: z.enum(["A", "B", "C", "D", "1", "2", "3", "4"]),
  pos: Vec2Schema,
});

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

const EffectBehaviorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("vuln"), damageType: z.enum(["physical", "magical"]), multiplier: z.number().positive() }),
  z.object({ kind: z.literal("pyretic"), dps: z.number().nonnegative() }),
  z.object({ kind: z.literal("freeze"), dps: z.number().nonnegative() }),
]);

const ApplyEffectSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["buff", "debuff"]),
  duration: z.number().positive(),
  behavior: EffectBehaviorSchema,
});

const AOEEventSchema = z.object({
  type: z.literal("aoe").default("aoe"),
  t: z.number().nonnegative(),
  name: z.string().min(1),
  telegraph: z.number().positive(),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  shape: AOEShapeSchema,
  applyEffect: ApplyEffectSchema.optional(),
  showCastBar: z.boolean().optional(),
  showTelegraph: z.boolean().optional(),
});

const TargetedEventSchema = z.object({
  type: z.literal("targeted"),
  t: z.number().nonnegative(),
  name: z.string().min(1),
  targetMode: z.enum(["closest", "furthest"]),
  role: z.enum(["tank", "healer", "dps"]).optional(),
  radius: z.number().positive(),
  telegraph: z.number().positive(),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  applyEffect: ApplyEffectSchema.optional(),
  showCastBar: z.boolean().optional(),
  showTelegraph: z.boolean().optional(),
});

const TetherSourceEventSchema = z.object({
  type: z.literal("tether_source"),
  t: z.number().nonnegative(),
  name: z.string().min(1),
  pos: Vec2Schema,
  finalizeAfter: z.number().positive(),
  tetherKind: z.enum(["buff", "debuff"]),
  buffName: z.string().min(1),
  behavior: EffectBehaviorSchema.default({ kind: "none" }),
  effectDuration: z.number().positive().default(15),
});

export const EventSchema = z.union([TetherSourceEventSchema, AOEEventSchema, TargetedEventSchema]);

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
  players: z.array(PlayerDefSchema).length(ROSTER.length),
  events: z.array(EventSchema),
  waymarks: z.array(WaymarkSchema).optional(),
}).superRefine((raid, ctx) => {
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
});

export const BotPatternsSchema = z.object({
  players: z.record(z.string().min(1), z.array(WaypointSchema)),
});

export type RaidDef = z.infer<typeof RaidSchema>;
export type BotPatternsDef = z.infer<typeof BotPatternsSchema>;
