import { z } from "zod";

// Authoring accepts both YAML-friendly { x, z } objects and compact [x, z] tuples.
export const Vec2ObjectSchema = z.preprocess(
  value => Array.isArray(value) && value.length === 2 ? { x: value[0], z: value[1] } : value,
  z.strictObject({ x: z.number(), z: z.number() }),
);
