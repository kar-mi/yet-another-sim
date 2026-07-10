import type { AOEShape, EffectResolver, Player } from "@shared/types";
import { length, sub } from "@shared/math";
import { pointInShape } from "../shapes";
import type { TickContext } from "./context";
import { applyMechanicDamage, isEffectActiveAt } from "./helpers";
import { TARGETED_LINGER } from "@shared/constants";
import { FloorAoe, DEFAULT_DANGER_COLOR } from "@shared/floorAoe";

// One-shot visual: the mechanic already resolved this tick, so it's shown from right now through a
// short post-hit linger rather than through a normal telegraph cast.
export function addResolvedAoeVisual(ctx: TickContext, id: string, name: string, shape: AOEShape, color?: string): void {
  ctx.resolvedAoeVisuals.push({
    id,
    name,
    shape,
    telegraphStart: ctx.time,
    resolveAt: ctx.time,
    damage: 0,
    damageType: "true",
    resolved: true,
    showCastBar: false,
    showTelegraph: true,
    lingerFor: TARGETED_LINGER,
    floorAoe: new FloorAoe({
      id, shape, color: color ?? DEFAULT_DANGER_COLOR,
      resolveMode: { kind: "resolve", lead: 0, trail: TARGETED_LINGER },
      resolveAt: ctx.time,
    }),
  });
}

function carriersWithActiveEffect(
  carriers: Player[],
  resolver: EffectResolver,
  time: number,
): Array<{ player: Player; effectIds: string[] }> {
  const triggered: Array<{ player: Player; effectIds: string[] }> = [];
  for (const player of carriers) {
    const effectIds = player.effects
      .filter(effect => effect.name === resolver.effectName && isEffectActiveAt(effect, time))
      .map(effect => effect.id);
    if (effectIds.length > 0) triggered.push({ player, effectIds });
  }
  return triggered;
}

function nearestOtherAlivePlayer(players: Player[], carrier: Player): Player | null {
  let nearest: Player | null = null;
  let nearestDist = Infinity;
  for (const player of players) {
    if (!player.alive || player.id === carrier.id) continue;
    const dist = length(sub(player.pos, carrier.pos));
    if (dist < nearestDist) {
      nearest = player;
      nearestDist = dist;
    }
  }
  return nearest;
}

function removeTriggeredEffects(triggered: Array<{ player: Player; effectIds: string[] }>): void {
  for (const { player, effectIds } of triggered) {
    const ids = new Set(effectIds);
    player.effects = player.effects.filter(effect => !ids.has(effect.id));
  }
}

export function triggerEffectResolver(ctx: TickContext, resolver: EffectResolver, carriers: Player[]): Player[] {
  const { players, log, time } = ctx;
  const triggered = carriersWithActiveEffect(carriers, resolver, time);
  if (triggered.length === 0) return [];

  const action = resolver.action;
  if (action.kind === "spread") {
    for (const { player: carrier } of triggered) {
      if (!carrier.alive) continue;
      const circle: AOEShape = { kind: "circle", center: carrier.pos, radius: action.radius };
      addResolvedAoeVisual(ctx, `${resolver.id}-${carrier.id}-visual`, resolver.name, circle);
      for (const player of players) {
        if (!player.alive || !pointInShape(circle, player.pos)) continue;
        applyMechanicDamage(player, action.damage, action.damageType, time);
        log.push({ t: time, mechanic: resolver.name, playerId: player.id, event: "hit" });
      }
    }
  } else if (action.kind === "stack") {
    for (const { player: carrier } of triggered) {
      if (!carrier.alive) continue;
      const circle: AOEShape = { kind: "circle", center: carrier.pos, radius: action.radius };
      addResolvedAoeVisual(ctx, `${resolver.id}-${carrier.id}-visual`, resolver.name, circle);
      const soakers = players.filter(player => player.alive && pointInShape(circle, player.pos));
      const success = soakers.length >= action.requiredCount;
      const per = success ? action.damage / soakers.length : action.damage;
      for (const player of soakers) {
        applyMechanicDamage(player, per, action.damageType, time);
        log.push({ t: time, mechanic: resolver.name, playerId: player.id, event: "hit" });
      }
    }
  } else {
    for (const { player: carrier } of triggered) {
      if (!carrier.alive) continue;
      const target = nearestOtherAlivePlayer(players, carrier);
      if (!target) continue;
      const direction = sub(target.pos, carrier.pos);
      if (length(direction) <= 1e-6) continue;
      const cone: AOEShape = {
        kind: "cone",
        origin: carrier.pos,
        direction,
        angleDeg: action.angleDeg,
        length: action.length,
      };
      addResolvedAoeVisual(ctx, `${resolver.id}-${carrier.id}-visual`, resolver.name, cone);
      for (const player of players) {
        if (!player.alive || player.id === carrier.id || !pointInShape(cone, player.pos)) continue;
        applyMechanicDamage(player, action.damage, action.damageType, time);
        log.push({ t: time, mechanic: resolver.name, playerId: player.id, event: "hit" });
      }
    }
  }

  removeTriggeredEffects(triggered);
  return triggered.map(({ player }) => player);
}
