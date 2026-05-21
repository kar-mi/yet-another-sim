import { RaidSchema, type RaidDef } from "./raidSchema";

export function loadRaid(json: unknown): RaidDef {
  const result = RaidSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid raid JSON:\n${result.error.message}`);
  }
  return result.data;
}
