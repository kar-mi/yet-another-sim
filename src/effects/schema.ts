import { z } from "zod";

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected a #rrggbb color");

const RangeSchema = z.object({
  min: z.number().finite().nonnegative(),
  max: z.number().finite().nonnegative(),
}).refine(range => range.max >= range.min, "max must be >= min");

const ElementSchema = z.enum(["lightning", "fire", "ice"]);

const FloorVfxSchema = z.object({
  element: z.boolean().optional(),
  intensity: z.number().finite().positive().optional(),
}).strict();

const BurstVfxSchema = z.object({
  enabled: z.boolean().optional(),
  element: ElementSchema.optional(),
  color: HexColorSchema.optional(),
  count: z.number().int().positive().optional(),
  size: RangeSchema.optional(),
  lifetime: RangeSchema.refine(range => range.min > 0, "lifetime min must be positive").optional(),
}).strict();

const WeaponGlowVfxSchema = z.object({
  enabled: z.boolean().optional(),
  color: HexColorSchema.optional(),
  intensity: RangeSchema.optional(),
  pulsePeriod: z.number().finite().positive().optional(),
}).strict();

export const VfxSchema = z.object({
  floor: FloorVfxSchema.optional(),
  burst: BurstVfxSchema.optional(),
  weaponGlow: WeaponGlowVfxSchema.optional(),
}).strict();
