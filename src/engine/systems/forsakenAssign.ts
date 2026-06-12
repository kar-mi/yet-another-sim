import type { EffectSpec, ForsakenAssignmentKind, PendingForsakenAssign, Player } from "../../shared/types";
import type { TickContext } from "./context";
import { applyEffect, isEffectActiveAt } from "./helpers";

const ASSIGNMENT_EFFECTS: Record<ForsakenAssignmentKind, { name: string; markerIcon: string }> = {
  cone: { name: "Cone Charge", markerIcon: "cone_processed.png" },
  stack: { name: "Stack Charge", markerIcon: "stack_processed.png" },
  spread: { name: "Defamation Charge", markerIcon: "defam_processed.png" },
  defamation: { name: "Defamation Charge", markerIcon: "defam_processed.png" },
};

export type ForsakenChargeKind = "stack" | "cone" | "defamation";

const FORSAKEN_CHARGE_ORDER: ForsakenChargeKind[] = ["stack", "cone", "defamation"];
const FORSAKEN_ODD_TOWER_COUNTS: Record<ForsakenChargeKind, number> = { stack: 2, cone: 3, defamation: 3 };
const FORSAKEN_EVEN_TOWER_COUNTS: Record<ForsakenChargeKind, number> = { stack: 0, cone: 4, defamation: 4 };
const FORSAKEN_REASSIGN_DURATION = 120;
const FORSAKEN_REASSIGN_MARKER_DURATION = 5;

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

function normalizedChargeKind(effectName: string): ForsakenChargeKind | undefined {
  if (effectName === ASSIGNMENT_EFFECTS.stack.name) return "stack";
  if (effectName === ASSIGNMENT_EFFECTS.cone.name) return "cone";
  if (effectName === ASSIGNMENT_EFFECTS.defamation.name) return "defamation";
  return undefined;
}

export function activeForsakenCharge(player: Player, time: number): ForsakenChargeKind | undefined {
  for (const effect of player.effects) {
    const kind = normalizedChargeKind(effect.name);
    if (kind && isEffectActiveAt(effect, time)) return kind;
  }
  return undefined;
}

function targetCountsAfterTower(towerNumber: number): Record<ForsakenChargeKind, number> {
  return towerNumber % 2 === 1 ? FORSAKEN_EVEN_TOWER_COUNTS : FORSAKEN_ODD_TOWER_COUNTS;
}

function uniquePlayersInRosterOrder(players: Player[], resolvedPlayers: Player[]): Player[] {
  const resolvedIds = new Set(resolvedPlayers.map(player => player.id));
  return players.filter(player => resolvedIds.has(player.id));
}

export function resolveForsakenTowerDebuffSwaps(ctx: TickContext, towerNumber: number, resolvedPlayers: Player[]): void {
  if (!ctx.world.forsakenPlan) return;
  const targets = targetCountsAfterTower(towerNumber);
  const current: Record<ForsakenChargeKind, number> = { stack: 0, cone: 0, defamation: 0 };
  for (const player of ctx.players) {
    if (!player.alive) continue;
    const kind = activeForsakenCharge(player, ctx.time);
    if (kind) current[kind]++;
  }

  const needed: ForsakenChargeKind[] = [];
  for (const kind of FORSAKEN_CHARGE_ORDER) {
    const missing = targets[kind] - current[kind];
    for (let i = 0; i < missing; i++) needed.push(kind);
  }

  const playersToAssign = uniquePlayersInRosterOrder(ctx.players, resolvedPlayers).filter(player => player.alive);
  for (let i = 0; i < playersToAssign.length && i < needed.length; i++) {
    const player = playersToAssign[i]!;
    const kind = needed[i]!;
    const assignmentSpec = ASSIGNMENT_EFFECTS[kind];
    applyEffect(player, assignmentEffect(assignmentSpec.name, FORSAKEN_REASSIGN_DURATION), ctx.time, `forsaken-tower-${towerNumber}-${player.id}-assignment`, ctx.players);
    applyEffect(player, markerIconEffect(`${assignmentSpec.name} Marker`, assignmentSpec.markerIcon, FORSAKEN_REASSIGN_MARKER_DURATION), ctx.time, `forsaken-tower-${towerNumber}-${player.id}-assignment-marker`, ctx.players);
  }
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
      // Past/Future is a property of each stored ending cone (its directionOffset), not a per-player
      // debuff, so only the charge assignment is applied here.
      applyEffect(player, assignmentEffect(assignmentName, event.duration), ctx.time, `${event.id}-${player.id}-assignment`, ctx.players);
      applyEffect(player, markerIconEffect(`${assignmentName} Marker`, assignmentSpec.markerIcon, event.markerDuration), ctx.time, `${event.id}-${player.id}-assignment-marker`, ctx.players);
    }
  }
  return remaining;
}
