// The mutable state threaded through every per-mechanic system in a single tick. Systems read and
// mutate these shared fields in place; the orchestrator (sim.ts `tick`) builds the context, runs
// the systems in a fixed order, then assembles the returned World snapshot from the context plus
// each system's own remaining/still slices.
//
// IMPORTANT: the systems run in a fixed order because the seeded RNG is drawn in sequence — every
// `randInt`/`randFloat` call advances `rngState`, so reordering systems changes which mechanic gets
// which random value and breaks reproducibility. Do not reorder the calls in the orchestrator.

import type { World, Intents, Player, Boss, LogEntry, ActiveForcedMarch, ActiveMechanic } from "@shared/types";
import { nextRandom, randomInt } from "@shared/rng";

export interface TickContext {
  readonly world: World;        // incoming snapshot (read-only source for pending/active fields)
  readonly intents: Intents;
  readonly dt: number;
  readonly time: number;        // world.time + dt
  readonly previousTime: number; // world.time

  players: Player[];            // cloned, mutated in place by the systems
  bosses: Boss[];               // cloned array; boss === bosses[0] (same reference)
  boss: Boss;                   // alias for bosses[0] (threat deep-cloned)
  log: LogEntry[];
  groupChoices: Record<string, number>; // group/link event id -> chosen index (shared for linking)
  actedByPlayer: Map<string, boolean>;   // set by movement, read by status-effect dot conditions

  // Seeded PRNG threaded through the tick. The closures advance `rngState` in place; the final
  // state is read back into the returned world by the orchestrator.
  rngState: number;
  readonly randFloat: () => number;
  readonly randInt: (n: number) => number;

  // Shared accumulator: built by the forced-march system, then appended to by the status-effect
  // system when a plant debuff expires. The orchestrator returns the final array.
  forcedMarches: ActiveForcedMarch[];
  // Shared accumulator for instant resolved AOE visuals emitted by systems that do not own the
  // normal AOE active list.
  resolvedAoeVisuals: ActiveMechanic[];
  // Towers that resolved this tick with a consumed charge debuff: each entry is the tower's labels +
  // the ids of the players whose debuff a resolver consumed. The reassign system (running after
  // towers in the same tick) reads this to re-balance charges onto those players.
  resolvedTowers: { labels: string[]; playerIds: string[] }[];
}

export function createTickContext(world: World, intents: Intents, dt: number): TickContext {
  // Clone each boss with its own deep-cloned threat table. boss === bosses[0] by reference.
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
    groupChoices: { ...world.groupChoices },
    actedByPlayer: new Map<string, boolean>(),
    rngState: world.rngState,
    forcedMarches: [] as ActiveForcedMarch[],
    resolvedAoeVisuals: [] as ActiveMechanic[],
    resolvedTowers: [] as { labels: string[]; playerIds: string[] }[],
    // Closures capture `ctx` so a bare reference (e.g. passed to effectsForMechanic) still advances
    // the shared rngState.
    randFloat: (): number => {
      const r = nextRandom(ctx.rngState); ctx.rngState = r.state; return r.value;
    },
    randInt: (n: number): number => {
      const r = randomInt(ctx.rngState, n); ctx.rngState = r.state; return r.value;
    },
  };
  return ctx;
}
