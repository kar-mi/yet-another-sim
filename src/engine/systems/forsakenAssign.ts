import type { EffectSpec, PendingForsakenAssign } from "../../shared/types";
import type { TickContext } from "./context";
import { applyEffect } from "./helpers";

const ASSIGNMENT_MARKERS: Record<string, string> = {
  cone: "CONE",
  stack: "STACK",
  spread: "SPRD",
  defamation: "DEF",
};

const ENDING_MARKERS: Record<string, string> = {
  future: "F",
  past: "P",
};

function assignmentEffect(name: string, duration: number): EffectSpec {
  return {
    name,
    kind: "debuff",
    duration,
    visibility: "invisible",
    behavior: { kind: "none" },
  };
}

function markerEffect(name: string, marker: string, duration: number): EffectSpec {
  return {
    name,
    kind: "debuff",
    duration,
    visibility: "invisible",
    marker,
    behavior: { kind: "none" },
  };
}

export function resolveForsakenAssigns(ctx: TickContext): PendingForsakenAssign[] {
  const remaining: PendingForsakenAssign[] = [];
  for (const event of ctx.world.pendingForsakenAssigns) {
    if (event.t > ctx.time) {
      remaining.push(event);
      continue;
    }

    const plan = ctx.world.forsakenPlan;
    if (!plan) continue;

    for (const player of ctx.players) {
      if (!player.alive) continue;
      const assignment = plan.players[player.id];
      if (!assignment) continue;

      const assignmentName = `Forsaken ${assignment.assignment[0].toUpperCase()}${assignment.assignment.slice(1)}`;
      const endingName = `Forsaken ${assignment.ending[0].toUpperCase()}${assignment.ending.slice(1)}`;
      applyEffect(player, assignmentEffect(assignmentName, event.duration), ctx.time, `${event.id}-${player.id}-assignment`, ctx.players);
      applyEffect(player, markerEffect(`${assignmentName} Marker`, ASSIGNMENT_MARKERS[assignment.assignment], event.markerDuration), ctx.time, `${event.id}-${player.id}-assignment-marker`, ctx.players);
      applyEffect(player, assignmentEffect(endingName, event.duration), ctx.time, `${event.id}-${player.id}-ending`, ctx.players);
      applyEffect(player, markerEffect(`${endingName} Marker`, ENDING_MARKERS[assignment.ending], event.markerDuration), ctx.time, `${event.id}-${player.id}-ending-marker`, ctx.players);
    }
  }
  return remaining;
}
