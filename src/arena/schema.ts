import { z } from "zod";
import { Vec2ObjectSchema } from "@shared/schema";
import { ARENA_GENERATOR_IDS, ARENA_GENERATORS } from "./generators";
import { FLOOR_PLAN_IMAGE_IDS, ZONE_IMAGE_IDS } from "./assets";

const FloorPlanSchema = z.union([
  z.enum(["squares", ...FLOOR_PLAN_IMAGE_IDS]),
  z.strictObject({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "floor color must be a six-digit hex color") }),
]).default("squares");

export const ZoneShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circle"), center: Vec2ObjectSchema, radius: z.number().positive() }),
  z.object({ kind: z.literal("rect"), center: Vec2ObjectSchema, width: z.number().positive(), height: z.number().positive() }),
  z.object({ kind: z.literal("polygon"), vertices: z.array(Vec2ObjectSchema).min(3), image: z.enum(ZONE_IMAGE_IDS).optional() }),
]);

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
