import { z } from "zod";
import { resolveStatus } from "./resolve";
import type { StatusSpec } from "./types";
import { STATUS_FIELDS } from "./validation";

export { STATUS_BEHAVIOR_KINDS, StatusSpecSchema } from "./validation";

const StatusRefObjectSchema = z.object({
  ref: z.string({ error: "statuses must reference a catalog template with `ref`" })
    .regex(/^[a-z][a-z0-9_]*$/, "status ref must be a snake_case id"),
  ...Object.fromEntries(Object.entries(STATUS_FIELDS).map(([key, schema]) => [key, schema.optional()])) as {
    [K in keyof typeof STATUS_FIELDS]: z.ZodOptional<(typeof STATUS_FIELDS)[K]>
  },
  behavior: z.record(z.string(), z.unknown()).optional(),
});

export const StatusRefSchema = StatusRefObjectSchema.transform((ref, ctx): StatusSpec => {
  const resolved = resolveStatus(ref as Parameters<typeof resolveStatus>[0]);
  if (!resolved.ok) {
    ctx.addIssue({ code: "custom", path: ["ref"], message: resolved.error });
    return z.NEVER;
  }
  return resolved.spec;
});

export const StatusBundleSchema = z.object({
  effects: z.array(StatusRefSchema).min(1),
  order: z.enum(["listed", "shuffle", "shuffleBalanced"]).default("listed"),
});

export const StatusIdSchema = (kind?: "buff" | "debuff") => z.string().min(1).transform((ref, ctx): StatusSpec => {
  const resolved = resolveStatus({ ref });
  if (!resolved.ok) {
    ctx.addIssue({ code: "custom", message: resolved.error });
    return z.NEVER;
  }
  if (kind !== undefined && resolved.spec.kind !== kind) {
    ctx.addIssue({ code: "custom", message: `status "${ref}" must be a ${kind}` });
    return z.NEVER;
  }
  return resolved.spec;
});
