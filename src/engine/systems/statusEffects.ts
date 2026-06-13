// Phase 4: continuous status effects and effect expiry. Tick dots (respecting move/idle
// conditions), fire the doubleTrouble burst and plant (Tele-Trouncing) trap on expiry, then drop
// expired effects. Plant traps are appended to ctx.forcedMarches (built in phase 1c) for next tick.

import type { TickContext } from "./context";
import type { AOEShape } from "@shared/types";
import { pointInShape } from "../shapes";
import { effectActiveDt, applyMechanicDamage, applyKnockback, isEffectActiveAt } from "./helpers";

export function applyStatusEffects(ctx: TickContext): void {
  const { players, log, time, previousTime, actedByPlayer, forcedMarches } = ctx;
  for (const player of players) {
    if (player.alive && !player.invincible) {
      const acted = actedByPlayer.get(player.id) ?? false;
      for (const effect of player.effects) {
        const activeDt = effectActiveDt(effect, previousTime, time);
        if (activeDt <= 0) continue;
        if (effect.behavior.kind === "dot") {
          const cond = effect.behavior.condition;
          const ticks = cond === "always" || (cond === "moving" && acted) || (cond === "idle" && !acted);
          if (ticks) {
            player.hp = Math.max(0, player.hp - effect.behavior.dps * activeDt);
            if (player.hp <= 0) {
              player.alive = false;
              log.push({ t: time, mechanic: effect.name, playerId: player.id, event: "hit" });
              break;
            }
          }
        }
      }
    }
    // Plant (Tele-Trouncing): when its debuff expires, place a teleport trap (forced march) at the
    // player's spot. It stays inert for `armDelay` (so the placer can step off) before triggering.
    if (player.alive) {
      for (const effect of player.effects) {
        if (effect.behavior.kind === "doubleTrouble") {
          const expiry = effect.appliedAt + effect.duration;
          if (expiry <= previousTime || expiry > time) continue;
          const b = effect.behavior;
          const circle: AOEShape = { kind: "circle", center: player.pos, radius: b.radius };
          for (const target of players) {
            if (!target.alive || !pointInShape(circle, target.pos)) continue;
            applyMechanicDamage(target, b.damage, b.damageType, time);
            if (target.id !== player.id && target.antiKbActive <= 0) {
              applyKnockback(target, { distance: b.knockbackDistance, height: 0, origin: player.pos }, player.pos, time);
            }
            log.push({ t: time, mechanic: effect.name, playerId: target.id, event: "hit" });
          }
          continue;
        }
        if (effect.behavior.kind !== "plant") continue;
        const expiry = effect.appliedAt + effect.duration;
        if (expiry <= previousTime || expiry > time) continue; // only the tick it expires on
        const b = effect.behavior;
        forcedMarches.push({
          id: `plant-${player.id}-${effect.id}`,
          name: effect.name,
          pos: { x: player.pos.x, z: player.pos.z },
          radius: b.radius,
          direction: { x: b.direction[0], z: b.direction[1] },
          distance: b.distance,
          preDelay: b.tpDelay,  // frozen at A during the windup, then an instant teleport to B
          postDelay: 0.3,
          relativeMove: true,
          armedAt: time + b.armDelay,
          expireAt: time + b.armDelay + b.duration,
          triggered: false,
          teleported: false,
        });
      }
    }
    player.effects = player.effects.filter(effect => isEffectActiveAt(effect, time));
  }
}
