// Phase 4: continuous status effects and effect expiry. Tick dots (respecting move/idle
// conditions), fire burstSpread and plant (Tele-Trouncing) expiry effects, then drop
// expired effects. Plant traps are appended to ctx.forcedMarches (built in phase 1c) for next tick.

import type { TickContext } from "./context";
import type { AOEShape, DamageType, EffectBehavior } from "@shared/types";
import { pointInShape } from "../shapes";
import { effectActiveDt, applyMechanicDamage, applyKnockback, isEffectActiveAt, selectTargetPlayers } from "./helpers";
import { addResolvedAoeVisual } from "./effectResolvers";

// Damages everyone inside `shape`, applies knockback from `origin` when `kbDistance` is set.
// `skipKbForId`: player id exempt from knockback (the carrier for the self-pop).
function applyShapeHit(
  players: TickContext["players"],
  log: TickContext["log"],
  time: number,
  shape: AOEShape,
  origin: { x: number; z: number },
  damage: number,
  damageType: DamageType,
  kbDistance: number | undefined,
  skipKbForId: string | undefined,
  name: string,
): void {
  for (const target of players) {
    if (!target.alive || !pointInShape(shape, target.pos)) continue;
    applyMechanicDamage(target, damage, damageType, time);
    if (kbDistance !== undefined && kbDistance > 0 && (skipKbForId === undefined || target.id !== skipKbForId) && target.antiKbActive <= 0) {
      applyKnockback(target, { distance: kbDistance, height: 0, origin }, origin, time);
    }
    log.push({ t: time, mechanic: name, playerId: target.id, event: "hit" });
  }
}

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
    // Accretion: cleansed by being healed to full HP (heal fires before status effects in sim.ts).
    if (player.alive && player.hp >= player.maxHp) {
      player.effects = player.effects.filter(e => !(isEffectActiveAt(e, time) && e.behavior.kind === "accretion"));
    }
    // Plant (Tele-Trouncing): when its debuff expires, place a teleport trap (forced march) at the
    // player's spot. It stays inert for `armDelay` (so the placer can step off) before triggering.
    // PrimordialCrust / Accretion: uncleansed expiry deals a lethal burst to the carrier.
    if (player.alive) {
      for (const effect of player.effects) {
        if (effect.behavior.kind === "burstSpread") {
          const expiry = effect.appliedAt + effect.duration;
          if (expiry <= previousTime || expiry > time) continue;
          const b = effect.behavior;
          const selfShape: AOEShape = (b.selfShape ?? "circle") === "donut"
            ? { kind: "donut", center: player.pos, inner: b.selfInner!, outer: b.radius }
            : { kind: "circle", center: player.pos, radius: b.radius };
          applyShapeHit(players, log, time, selfShape, player.pos, b.damage, b.damageType, b.knockbackDistance, player.id, effect.name);
          if (b.followUp) {
            const fu = b.followUp;
            const others = players.filter(p => p.alive && p.id !== player.id);
            const fuTargets = selectTargetPlayers(others, player.pos, fu.mode, fu.count);
            for (const fuTarget of fuTargets) {
              const fuShape: AOEShape = fu.shape === "donut"
                ? { kind: "donut", center: fuTarget.pos, inner: fu.inner!, outer: fu.radius }
                : { kind: "circle", center: fuTarget.pos, radius: fu.radius };
              applyShapeHit(players, log, time, fuShape, fuTarget.pos, fu.damage, fu.damageType, fu.knockbackDistance, undefined, effect.name);
              addResolvedAoeVisual(ctx, `${effect.id}-fu-${fuTarget.id}`, effect.name, fuShape);
            }
          }
          continue;
        }
        if (effect.behavior.kind === "plant") {
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
          continue;
        }
        if (effect.behavior.kind === "primordialCrust" || effect.behavior.kind === "accretion" || effect.behavior.kind === "assignment") {
          const expiry = effect.appliedAt + effect.duration;
          if (expiry <= previousTime || expiry > time) continue;
          const b = effect.behavior as Extract<EffectBehavior, { kind: "primordialCrust" } | { kind: "accretion" } | { kind: "assignment" }>;
          applyMechanicDamage(player, b.expiryDamage, b.expiryDamageType, time);
          if (!player.alive) log.push({ t: time, mechanic: effect.name, playerId: player.id, event: "hit" });
        }
      }
    }
    player.effects = player.effects.filter(effect => isEffectActiveAt(effect, time));
  }
}
