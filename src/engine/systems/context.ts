// The mutable state threaded through every per-mechanic system in a single tick. Systems read and
// mutate these shared fields in place; the orchestrator (sim.ts `tick`) builds the context, runs
// the systems in a fixed order, then assembles the returned World snapshot from the context plus
// each system's own remaining/still slices.
//
// IMPORTANT: the systems run in a fixed order because the seeded RNG is drawn in sequence — every
// `randInt`/`randFloat` call advances `rngState`, so reordering systems changes which mechanic gets
// which random value and breaks reproducibility. Do not reorder the calls in the orchestrator.

import type { World, Intents, Player, Boss, LogEntry, ActiveForcedMarch } from "../../shared/types";
import { nextRandom, randomInt } from "../../shared/rng";

export interface TickContext {
  readonly world: World;        // incoming snapshot (read-only source for pending/active fields)
  readonly intents: Intents;
  readonly dt: number;
  readonly time: number;        // world.time + dt
  readonly previousTime: number; // world.time

  players: Player[];            // cloned, mutated in place by the systems
  boss: Boss;                   // cloned (threat deep-cloned)
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
}

export function createTickContext(world: World, intents: Intents, dt: number): TickContext {
  const ctx = {
    world,
    intents,
    dt,
    time: world.time + dt,
    previousTime: world.time,
    players: world.players.map(p => ({ ...p })),
    // tick never mutates the incoming world: clone the boss (threat is the one nested mutable
    // object we write) so the returned snapshot is fresh. See world.ts/net.ts.
    boss: { ...world.boss, threat: { ...world.boss.threat } },
    log: world.log.slice(),
    groupChoices: { ...world.groupChoices },
    actedByPlayer: new Map<string, boolean>(),
    rngState: world.rngState,
    forcedMarches: [] as ActiveForcedMarch[],
  } as TickContext;

  // Closures capture `ctx` so a bare reference (e.g. passed to effectsForMechanic) still advances
  // the shared rngState.
  (ctx as { randFloat: () => number }).randFloat = () => {
    const r = nextRandom(ctx.rngState); ctx.rngState = r.state; return r.value;
  };
  (ctx as { randInt: (n: number) => number }).randInt = (n: number) => {
    const r = randomInt(ctx.rngState, n); ctx.rngState = r.state; return r.value;
  };
  return ctx;
}
