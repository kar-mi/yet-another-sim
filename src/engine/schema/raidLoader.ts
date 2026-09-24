import { BotPatternsSchema, RaidSchema, type BotPatternsDef, type RaidDef } from "./raidSchema";

export function loadRaid(value: unknown): RaidDef {
  const result = RaidSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid raid data:\n${result.error.message}`);
  }
  return result.data;
}

export function loadBotPatterns(value: unknown): BotPatternsDef {
  const result = BotPatternsSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid bot pattern data:\n${result.error.message}`);
  }
  return result.data;
}

export function applyBotPatterns(raid: RaidDef, botPatterns: BotPatternsDef): RaidDef {
  return {
    ...raid,
    botSolvers: botPatterns.solvers ?? raid.botSolvers,
    players: raid.players.map(player => {
      const pattern = botPatterns.players[player.id];
      return pattern ? { ...player, pattern } : player;
    }),
  };
}
