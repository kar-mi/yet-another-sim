// Collects a recording's reviewable moments (avoidable hits and deaths) by replaying its input log
// once, when the replay is opened. The engine is deterministic, so this reproduces exactly the pull
// that was recorded, including the entries it emits into `world.log`. ReplayTransport already
// re-simulates from tick 0 on every seek, so this pass costs less than a single scrub.

import { TICK_DT } from "@shared/constants";
import type { Frame } from "@shared/protocol";
import type { LogEntry, MechanicSection, World } from "@shared/types";
import type { ReplayEvent, ReplayInsights, ReplayPlayerLabel } from "@shared/replay";
import { computeBotIntents } from "../engine/botIntent";
import { tick } from "../engine/sim";
import { applyFrameControls } from "./simulationReplica";

// Separates the two halves of a hit's lookup key. Neither player ids nor source keys contain it.
const KEY_SEPARATOR = "|";

export function collectReplayInsights(replay: { world: World; frames: Frame[] }): ReplayInsights {
  const sections = [...replay.world.sections].sort((a, b) => a.t - b.t);
  // The roster carries no display names, so the party slot id is the label.
  const players: ReplayPlayerLabel[] = replay.world.players.map(player => ({ id: player.id, label: player.id }));
  const labelById = new Map(players.map(player => [player.id, player.label]));

  const events: ReplayEvent[] = [];
  let world = replay.world;
  let appliedTick = 0;
  for (const frame of replay.frames) {
    // Mirrors SimulationReplica.stepOne so collected ticks line up with what playback shows.
    if (world.status === "running") {
      const prepared = applyFrameControls(world, frame);
      const bots = computeBotIntents(prepared, TICK_DT);
      world = tick(prepared, { ...bots, ...frame.intents }, TICK_DT);
    }
    appliedTick++;
    if (world.log.length === 0) continue;
    collectTick(world.log, appliedTick, labelById, sections, events);
    // The log accumulates across ticks; drain it so each tick reports only its own entries.
    world.log = [];
  }

  return { events, sections, players };
}

function collectTick(
  log: LogEntry[],
  tickIndex: number,
  labelById: Map<string, string>,
  sections: MechanicSection[],
  events: ReplayEvent[],
): void {
  const sectionId = sectionAt(sections, tickIndex * TICK_DT);
  // A lethal avoidable hit records the hit and then the death in the same tick, so a death links
  // back to the hit that caused it by matching player and source.
  const hitsThisTick = new Map<string, string>();
  for (const entry of log) {
    if (entry.event !== "avoidableHit" && entry.event !== "death") continue;
    const id = `e${tickIndex}-${events.length}`;
    const event: ReplayEvent = {
      id,
      tick: tickIndex,
      playerId: entry.playerId,
      playerLabel: labelById.get(entry.playerId) ?? entry.playerId,
      kind: entry.event === "death" ? "death" : "hit",
      sourceId: entry.source ?? entry.mechanic,
      sourceName: entry.mechanic,
      ...(sectionId !== undefined ? { sectionId } : {}),
    };
    const key = `${entry.playerId}${KEY_SEPARATOR}${event.sourceId}`;
    if (entry.event === "avoidableHit") {
      event.hpLoss = entry.hpLoss ?? 0;
      hitsThisTick.set(key, id);
    } else {
      const hitId = hitsThisTick.get(key);
      if (hitId !== undefined) event.hitEventId = hitId;
    }
    events.push(event);
  }
}

// The last section that has started; a moment before the first section belongs to none.
function sectionAt(sections: MechanicSection[], time: number): string | undefined {
  let found: string | undefined;
  for (const section of sections) {
    if (section.t > time) break;
    found = section.id;
  }
  return found;
}
