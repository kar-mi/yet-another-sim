// Phase 4: continuous status effects and effect expiry. Tick dots (respecting move/idle
// conditions), fire burstSpread and plant (Tele-Trouncing) expiry effects, then drop
// expired effects. Plant traps are appended to ctx.forcedMarches (built in phase 1c) for next tick.

import type { TickContext } from "./context";
import { BEHAVIOR_REGISTRY } from "../status/behaviors";
import { applyPendingBurstSpreadFollowUp } from "../status/lifecycle";
import { isEffectActiveAt } from "./helpers";

export function applyStatusEffects(ctx: TickContext): void {
  const { players, time, previousTime, actedByPlayer } = ctx;
  const remainingFollowUps = [];
  for (const pending of ctx.pendingBurstSpreadFollowUps) {
    if (pending.t > time) {
      remainingFollowUps.push(pending);
      continue;
    }
    applyPendingBurstSpreadFollowUp(ctx, pending);
  }
  ctx.pendingBurstSpreadFollowUps = remainingFollowUps;
  // Crystal-origin follow-ups share one origin across all carriers of a mechanic, so they resolve
  // once per tick (keyed by mechanic + element) rather than once per carrier — otherwise N carriers
  // each fire `count` overlapping AOEs from the same crystal.
  const scratch = { resolvedCrystalFollowUps: new Set<string>() };
  for (const player of players) {
    if (player.alive && !player.invincible) {
      const acted = actedByPlayer.get(player.id) ?? false;
      for (const effect of player.effects) {
        BEHAVIOR_REGISTRY[effect.behavior.kind].onTick?.(effect, player, ctx, acted);
        if (!player.alive) break;
      }
    }
    // Accretion: cleansed by being healed to full HP (heal fires before status effects in sim.ts).
    if (player.alive && player.hp >= player.maxHp) {
      player.effects = player.effects.filter(e => !(isEffectActiveAt(e, time) && BEHAVIOR_REGISTRY[e.behavior.kind].cleanseOnFullHp === true));
    }
    // Plant (Tele-Trouncing): when its debuff expires, place a teleport trap (forced march) at the
    // player's spot. It stays inert for `armDelay` (so the placer can step off) before triggering.
    // PrimordialCrust / Accretion: uncleansed expiry deals a lethal burst to the carrier.
    if (player.alive) {
      for (const effect of player.effects) {
        const expiry = effect.appliedAt + effect.duration;
        if (expiry <= previousTime || expiry > time) continue;
        BEHAVIOR_REGISTRY[effect.behavior.kind].onExpiry?.(effect, player, ctx, scratch);
      }
    }
    player.effects = player.effects.filter(effect => isEffectActiveAt(effect, time));
  }
}
