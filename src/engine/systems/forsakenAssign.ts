import type { EffectSpec, ForsakenAssignmentKind, PendingForsakenAssign } from "../../shared/types";
import type { TickContext } from "./context";
import { applyEffect } from "./helpers";

const ASSIGNMENT_EFFECTS: Record<ForsakenAssignmentKind, { name: string; markerIcon: string }> = {
  cone: { name: "Cone Charge", markerIcon: "cone_processed.png" },
  stack: { name: "Stack Charge", markerIcon: "stack_processed.png" },
  spread: { name: "Spread Charge", markerIcon: "defam_processed.png" },
  defamation: { name: "Spread Charge", markerIcon: "defam_processed.png" },
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

function markerIconEffect(name: string, markerIcon: string, duration: number): EffectSpec {
  return {
    name,
    kind: "debuff",
    duration,
    visibility: "invisible",
    markerIcon,
    behavior: { kind: "none" },
  };
}

function markerTextEffect(name: string, marker: string, duration: number): EffectSpec {
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

      const assignmentSpec = ASSIGNMENT_EFFECTS[assignment.assignment];
      const assignmentName = assignmentSpec.name;
      const endingName = `Forsaken ${assignment.ending[0].toUpperCase()}${assignment.ending.slice(1)}`;
      applyEffect(player, assignmentEffect(assignmentName, event.duration), ctx.time, `${event.id}-${player.id}-assignment`, ctx.players);
      applyEffect(player, markerIconEffect(`${assignmentName} Marker`, assignmentSpec.markerIcon, event.markerDuration), ctx.time, `${event.id}-${player.id}-assignment-marker`, ctx.players);
      applyEffect(player, assignmentEffect(endingName, event.duration), ctx.time, `${event.id}-${player.id}-ending`, ctx.players);
      applyEffect(player, markerTextEffect(`${endingName} Marker`, ENDING_MARKERS[assignment.ending], event.markerDuration), ctx.time, `${event.id}-${player.id}-ending-marker`, ctx.players);
    }
  }
  return remaining;
}
