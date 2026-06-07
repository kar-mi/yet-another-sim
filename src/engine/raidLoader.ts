import { BotPatternsSchema, RaidSchema, type BotPatternsDef, type RaidDef } from "./raidSchema";

export function loadRaid(json: unknown): RaidDef {
  const result = RaidSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid raid JSON:\n${result.error.message}`);
  }
  return result.data;
}

export function loadBotPatterns(json: unknown): BotPatternsDef {
  const result = BotPatternsSchema.safeParse(json);
  if (!result.success) {
    throw new Error(`Invalid bot pattern JSON:\n${result.error.message}`);
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
