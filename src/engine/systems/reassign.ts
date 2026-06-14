// Generic charge distribution + re-balance. The opener (`initial: "plan"`) stamps each player's
// planned charge from world.initialCharges. Thereafter, when a mechanic whose label appears in
// `onResolve` resolves a charge (its soakers' debuffs are consumed by the tower resolvers first),
// this re-balances charges back up to that label's target counts, dealing the deficit onto the
// just-resolved players in roster order.

import type { Player, Reassign, ReassignCharge } from "@shared/types";
import type { TickContext } from "./context";
import { applyEffect, isEffectActiveAt } from "./helpers";

// The charge kind currently active on a player (matched by the charge effect's name), or undefined.
function activeChargeKind(player: Player, time: number, kindByEffectName: Map<string, string>): string | undefined {
  for (const effect of player.effects) {
    const kind = kindByEffectName.get(effect.name);
    if (kind && isEffectActiveAt(effect, time)) return kind;
  }
  return undefined;
}

function applyCharge(ctx: TickContext, player: Player, charge: ReassignCharge, idPrefix: string): void {
  applyEffect(player, charge.effect, ctx.time, `${idPrefix}-charge`, ctx.players);
  if (charge.marker) applyEffect(player, charge.marker, ctx.time, `${idPrefix}-marker`, ctx.players);
}

export function resolveReassigns(ctx: TickContext): { reassigns: Reassign[] } {
  const reassigns = ctx.world.reassigns.map(r => ({ ...r }));

  for (const reassign of reassigns) {
    const chargeByKind = new Map(reassign.charges.map(c => [c.kind, c]));
    const kindByEffectName = new Map(reassign.charges.map(c => [c.effect.name, c.kind]));

    // Opener: apply each alive player's planned kind from world.initialCharges.
    if (reassign.initial === "plan" && !reassign.initialDealt && reassign.t <= ctx.time) {
      for (const player of ctx.players) {
        if (!player.alive) continue;
        const charge = chargeByKind.get(ctx.world.initialCharges[player.id] ?? "");
        if (charge) applyCharge(ctx, player, charge, `${reassign.id}-initial-${player.id}`);
      }
      reassign.initialDealt = true;
    }

    if (!reassign.onResolve) continue;

    // Re-balance per trigger label. A wave's two towers share a label, so union their resolved
    // players into one deal. Labels repeat across waves but each wave resolves at a distinct tick,
    // so ctx.time keeps the applied effect ids unique.
    for (const [label, targetCounts] of Object.entries(reassign.onResolve)) {
      const recipientIds = new Set<string>();
      for (const resolved of ctx.resolvedTowers) {
        if (resolved.labels.includes(label)) {
          for (const id of resolved.playerIds) recipientIds.add(id);
        }
      }
      if (recipientIds.size === 0) continue;

      // Current live count per kind across the whole roster (soakers' charges already consumed).
      const current: Record<string, number> = {};
      for (const player of ctx.players) {
        if (!player.alive) continue;
        const kind = activeChargeKind(player, ctx.time, kindByEffectName);
        if (kind) current[kind] = (current[kind] ?? 0) + 1;
      }

      // Per-kind deficits, in charges-list order, dealt onto the just-resolved players in roster order.
      const needed: string[] = [];
      for (const charge of reassign.charges) {
        const missing = (targetCounts[charge.kind] ?? 0) - (current[charge.kind] ?? 0);
        for (let i = 0; i < missing; i++) needed.push(charge.kind);
      }
      const recipients = ctx.players.filter(p => p.alive && recipientIds.has(p.id));
      for (let i = 0; i < recipients.length && i < needed.length; i++) {
        const charge = chargeByKind.get(needed[i]!)!;
        applyCharge(ctx, recipients[i]!, charge, `${reassign.id}-${label}-${ctx.time}-${recipients[i]!.id}`);
      }
    }
  }

  return { reassigns };
}
