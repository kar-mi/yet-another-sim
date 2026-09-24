import type { World, Intents, Player, Boss, LogEntry, ActiveForcedMarch, ActiveMechanic, PendingBurstSpreadFollowUp, PendingTwister } from "@model/types";
import { nextRandom, randomInt } from "@shared/rng";

export interface TickContext {
  readonly world: World;
  readonly intents: Intents;
  readonly dt: number;
  readonly time: number;
  readonly previousTime: number;

  players: Player[];
  bosses: Boss[];
  boss: Boss;
  log: LogEntry[];
  readonly avoidableSources: Record<string, true>;
  groupChoices: Record<string, number>;
  actedByPlayer: Map<string, boolean>;

  rngState: number;
  readonly randFloat: () => number;
  readonly randInt: (n: number) => number;

  forcedMarches: ActiveForcedMarch[];
  resolvedAoeVisuals: ActiveMechanic[];
  pendingBurstSpreadFollowUps: PendingBurstSpreadFollowUp[];
  pendingTwisters: PendingTwister[];
  resolvedTowers: { labels: string[]; playerIds: string[] }[];
}

export function createTickContext(world: World, intents: Intents, dt: number): TickContext {
  const bosses = world.bosses.map(b => ({ ...b, threat: { ...b.threat } }));
  const ctx = {
    world,
    intents,
    dt,
    time: world.time + dt,
    previousTime: world.time,
    players: world.players.map(p => ({ ...p })),
    bosses,
    boss: bosses[0]!,
    log: world.log.slice(),
    avoidableSources: world.avoidableSources,
    groupChoices: { ...world.groupChoices },
    actedByPlayer: new Map<string, boolean>(),
    rngState: world.rngState,
    forcedMarches: [] as ActiveForcedMarch[],
    resolvedAoeVisuals: [] as ActiveMechanic[],
    pendingBurstSpreadFollowUps: world.pendingBurstSpreadFollowUps.slice(),
    pendingTwisters: world.pendingTwisters.slice(),
    resolvedTowers: [] as { labels: string[]; playerIds: string[] }[],
    randFloat: (): number => {
      const r = nextRandom(ctx.rngState); ctx.rngState = r.state; return r.value;
    },
    randInt: (n: number): number => {
      const r = randomInt(ctx.rngState, n); ctx.rngState = r.state; return r.value;
    },
  };
  return ctx;
}
