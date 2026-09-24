import type { AOEShape, EffectResolver, Player } from "@model/types";
import { length, sub } from "@shared/math";
import type { TickContext } from "./context";
import { closestOtherAliveActor, isStatusActive, removeStatuses } from "@status";
import { hitPlayersInShape, resolveStackShare } from "./strikes";
import { mechanicSource } from "./damageLog";
import { TARGETED_LINGER } from "@shared/constants";
import { FloorAoe, DEFAULT_DANGER_COLOR } from "@effects";

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
      .filter(effect => effect.name === resolver.effectName && isStatusActive(effect, time))
      .map(effect => effect.id);
    if (effectIds.length > 0) triggered.push({ player, effectIds });
  }
  return triggered;
}

function removeTriggeredEffects(triggered: Array<{ player: Player; effectIds: string[] }>): void {
  for (const { player, effectIds } of triggered) removeStatuses(player, effectIds);
}

export function triggerEffectResolver(ctx: TickContext, resolver: EffectResolver, carriers: Player[]): Player[] {
  const { players, time } = ctx;
  const triggered = carriersWithActiveEffect(carriers, resolver, time);
  if (triggered.length === 0) return [];

  const action = resolver.action;
  if (action.kind === "spread") {
    for (const { player: carrier } of triggered) {
      if (!carrier.alive) continue;
      const circle: AOEShape = { kind: "circle", center: carrier.pos, radius: action.radius };
      addResolvedAoeVisual(ctx, `${resolver.id}-${carrier.id}-visual`, resolver.name, circle);
      hitPlayersInShape(ctx, circle, action.damage, action.damageType, mechanicSource(ctx, resolver.id, resolver.name));
    }
  } else if (action.kind === "stack") {
    for (const { player: carrier } of triggered) {
      if (!carrier.alive) continue;
      const circle: AOEShape = { kind: "circle", center: carrier.pos, radius: action.radius };
      addResolvedAoeVisual(ctx, `${resolver.id}-${carrier.id}-visual`, resolver.name, circle);
      resolveStackShare(ctx, circle, action, action.damageType, mechanicSource(ctx, resolver.id, resolver.name));
    }
  } else {
    for (const { player: carrier } of triggered) {
      if (!carrier.alive) continue;
      const target = closestOtherAliveActor(carrier, players);
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
      hitPlayersInShape(ctx, cone, action.damage, action.damageType, mechanicSource(ctx, resolver.id, resolver.name), { excludeId: carrier.id });
    }
  }

  removeTriggeredEffects(triggered);
  return triggered.map(({ player }) => player);
}
