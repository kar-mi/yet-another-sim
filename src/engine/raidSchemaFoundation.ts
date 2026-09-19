import { z } from "zod";
import { ARENA_GENERATOR_IDS, ARENA_GENERATORS } from "./arenaGenerators";
import { EventIdSchema, RoleSchema, Vec2Schema } from "./raidSchemaPrimitives";

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

const FloorPlanSchema = z.union([
  z.enum(["squares", "dmu-p1", "dmu-p2"]),
  z.strictObject({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "floor color must be a six-digit hex color") }),
]).default("squares");

export const ZoneShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circle"), center: Vec2Schema, radius: z.number().positive() }),
  z.object({ kind: z.literal("rect"), center: Vec2Schema, width: z.number().positive(), height: z.number().positive() }),
  z.object({ kind: z.literal("polygon"), vertices: z.array(Vec2Schema).min(3), image: z.enum(["index-trapezoid", "index-square"]).optional() }),
]);

// Accept zones or a generator; expose resolved zones to the engine.
export const ArenaSchema = z.object({
  zones: z.array(ZoneShapeSchema).min(1).optional(),
  generator: z.enum(ARENA_GENERATOR_IDS).optional(),
  floorPlan: FloorPlanSchema,
}).superRefine((arena, ctx) => {
  if (!arena.zones === !arena.generator) {
    ctx.addIssue({ code: "custom", message: "arena needs exactly one of `zones` or `generator`" });
  }
}).transform(arena => ({
  zones: arena.zones ?? ARENA_GENERATORS[arena.generator!](),
  floorPlan: arena.floorPlan,
}));

export const AOEShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circle"), center: Vec2Schema, radius: z.number().positive() }),
  z.object({ kind: z.literal("donut"), center: Vec2Schema, inner: z.number().nonnegative(), outer: z.number().positive() }),
  z.object({ kind: z.literal("cone"), origin: Vec2Schema.default([0, 0]), direction: Vec2Schema.default([0, 1]), angleDeg: z.number().positive(), length: z.number().positive() }),
  z.object({ kind: z.literal("rect"), origin: Vec2Schema.default([0, 0]), direction: Vec2Schema.default([0, 1]), width: z.number().positive(), length: z.number().positive() }),
  z.object({ kind: z.literal("polygon"), vertices: z.array(Vec2Schema).min(3) }),
]).superRefine((shape, ctx) => {
  if (shape.kind === "donut" && shape.inner >= shape.outer) {
    ctx.addIssue({ code: "custom", message: "donut inner must be less than outer" });
  }
  if (shape.kind === "cone" && shape.direction[0] === 0 && shape.direction[1] === 0) {
    ctx.addIssue({ code: "custom", message: "cone direction must be a non-zero vector" });
  }
});

export const KnockbackSchema = z.object({
  distance: z.number().positive(),
  height: z.number().nonnegative().default(0), // 0 = horizontal knockback; >0 = knockup arc
  origin: Vec2Schema.optional(),               // defaults to the AOE shape's center/origin
});
