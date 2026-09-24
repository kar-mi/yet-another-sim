import { z } from "zod";
import { Vec2ObjectSchema } from "@shared/schema";

export const Vec2Schema = Vec2ObjectSchema.transform(({ x, z }) => [x, z] as [number, number]);
export const WaypointSchema = z.preprocess(
  value => typeof value === "object" && value !== null && "t" in value && !("time" in value)
    ? { ...value, time: value.t }
    : value,
  z.object({ time: z.number().nonnegative(), pos: Vec2Schema }),
).transform(({ time, pos }) => ({ t: time, pos }));
export const EventIdSchema = z.string().min(1);
export const RoleSchema = z.enum(["tank", "healer", "dps"]);
export const ElementGlyphKindSchema = z.enum(["lightning", "fire", "ice"]);
export const DebuffMatchSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);
