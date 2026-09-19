import type { StatusActor, StatusServices } from "./types";
import { handlerOf, type ExpiryContext } from "./behaviors";
import { applyStatus, cleanseAtFullHp } from "./operations";
import { expiresWithin, isStatusActive } from "./state";

export function tickStatuses<A extends StatusActor>(services: StatusServices<A>, acted: (actor: A) => boolean): void {
  const expiry: ExpiryContext = {
    resolvedCrystalFollowUps: new Set(),
    resolvedPairedSpreadStacks: new Set(),
    apply: (actor, spec, id) => applyStatus(actor, spec, id, services as StatusServices),
  };
  for (const actor of services.actors) {
    if (actor.alive && !actor.invincible) {
      const didAct = acted(actor);
      for (const status of actor.effects) {
        handlerOf(status.behavior).onTick?.(status, actor, services as StatusServices, didAct);
        if (!actor.alive) break;
      }
    }
    cleanseAtFullHp(actor, services.time);
    if (actor.alive) {
      for (const status of actor.effects) {
        if (expiresWithin(status, services.previousTime, services.time)) {
          handlerOf(status.behavior).onExpiry?.(status, actor, services as StatusServices, expiry);
        }
      }
    }
    actor.effects = actor.effects.filter(status => isStatusActive(status, services.time));
  }
}
