import type { Player, Reassign, ReassignCharge } from "@model/types";
import type { TickContext } from "./context";
import { applyStatus, isStatusActive } from "@status";
import { statusServices } from "./statusServices";

function activeChargeKind(player: Player, time: number, kindByEffectName: Map<string, string>): string | undefined {
  for (const effect of player.effects) {
    const kind = kindByEffectName.get(effect.name);
    if (kind && isStatusActive(effect, time)) return kind;
  }
  return undefined;
}

function applyCharge(ctx: TickContext, player: Player, charge: ReassignCharge, idPrefix: string): void {
  applyStatus(player, charge.effect, `${idPrefix}-charge`, statusServices(ctx));
  if (charge.marker) applyStatus(player, charge.marker, `${idPrefix}-marker`, statusServices(ctx));
}

export function resolveReassigns(ctx: TickContext): { reassigns: Reassign[] } {
  const reassigns = ctx.world.reassigns.map(r => ({ ...r }));

  for (const reassign of reassigns) {
    const chargeByKind = new Map(reassign.charges.map(c => [c.kind, c]));
    const kindByEffectName = new Map(reassign.charges.map(c => [c.effect.name, c.kind]));

    if (reassign.initial === "plan" && !reassign.initialDealt && reassign.t <= ctx.time) {
      for (const player of ctx.players) {
        if (!player.alive) continue;
        const charge = chargeByKind.get(ctx.world.initialCharges[player.id] ?? "");
        if (charge) applyCharge(ctx, player, charge, `${reassign.id}-initial-${player.id}`);
      }
      reassign.initialDealt = true;
    }

    if (!reassign.onResolve) continue;

    for (const [label, targetCounts] of Object.entries(reassign.onResolve)) {
      const recipientIds = new Set<string>();
      for (const resolved of ctx.resolvedTowers) {
        if (resolved.labels.includes(label)) {
          for (const id of resolved.playerIds) recipientIds.add(id);
        }
      }
      if (recipientIds.size === 0) continue;

      const current: Record<string, number> = {};
      for (const player of ctx.players) {
        if (!player.alive) continue;
        const kind = activeChargeKind(player, ctx.time, kindByEffectName);
        if (kind) current[kind] = (current[kind] ?? 0) + 1;
      }

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
