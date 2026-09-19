import type { Vec2 } from "@shared/math";
import { length, sub } from "@shared/math";
import type { ApplyEnv, DamageType, Knockback, StatusActor, StatusIcon, StatusInstance, StatusRuntime, StatusSpec } from "./types";
import { handlerOf } from "./behaviors";
import { isStatusActive, removeInstance, removeWhere, replaceInstance, statusSource } from "./state";

export function applyStatus(actor: StatusActor, spec: StatusSpec, id: string, env: ApplyEnv, runtime: StatusRuntime = {}): void {
  const handler = handlerOf(spec.behavior);
  const key = handler.reapplyKey?.(spec.behavior);
  const existing = key === undefined ? undefined : actor.effects.find(status =>
    isStatusActive(status, env.time)
    && status.behavior.kind === spec.behavior.kind
    && handler.reapplyKey!(status.behavior) === key);
  if (existing && handler.onReapply) {
    const reapply = (next: StatusSpec, nextId = id) => applyStatus(actor, next, nextId, env, runtime);
    if (handler.onReapply(existing, spec, actor, env, reapply) === "handled") return;
  }
  const status: StatusInstance = { ...spec, id, appliedAt: env.time, ...runtime };
  if (spec.group !== undefined) removeWhere(actor, other => isStatusActive(other, env.time) && other.group === spec.group);
  actor.effects = [...actor.effects, { ...status, ...handler.onApply?.(status, actor, env) }];
}

export function refreshStatus(actor: StatusActor, id: string, time: number): boolean {
  const status = actor.effects.find(candidate => candidate.id === id);
  if (!status) return false;
  replaceInstance(actor, status, { ...status, appliedAt: time });
  return true;
}

export function removeStatus(actor: StatusActor, id: string): void {
  removeWhere(actor, status => status.id === id);
}

export function removeStatuses(actor: StatusActor, ids: Iterable<string>): void {
  const set = new Set(ids);
  removeWhere(actor, status => set.has(status.id));
}

export function consumeStacks(actor: StatusActor, name: string, stacks: number, time: number): void {
  const status = actor.effects.find(candidate => candidate.name === name && isStatusActive(candidate, time));
  if (!status) return;
  if (status.stacks === undefined || status.stacks <= stacks) removeInstance(actor, status);
  else replaceInstance(actor, status, { ...status, stacks: status.stacks - stacks });
}

export function notifyMechanicHit(actor: StatusActor, mechanic: string, env: ApplyEnv): void {
  for (const status of actor.effects.slice()) {
    const onMechanicHit = handlerOf(status.behavior).onMechanicHit;
    if (!onMechanicHit || !isStatusActive(status, env.time)) continue;
    onMechanicHit(status, mechanic, actor, env, (spec, id = status.id) => applyStatus(actor, spec, id, env));
  }
}

export function slotStatus(actor: StatusActor, spec: StatusSpec, slotFor: (index: number) => { slot: number; direction?: [number, number] }): { spec: StatusSpec; slot?: number } {
  const slot = handlerOf(spec.behavior).slot;
  if (!slot) return { spec };
  const index = actor.effects.filter(status => status.behavior.kind === spec.behavior.kind).length;
  const assigned = slotFor(index);
  if (!assigned.direction) return { spec, slot: assigned.slot };
  return { spec: { ...spec, behavior: slot.stamp(spec.behavior, assigned.direction) }, slot: assigned.slot };
}

export function applyDamageModifiers(actor: StatusActor, damage: number, damageType: DamageType, sourceName: string, time: number): number {
  const consumed = new Set<string>();
  let dealt = damage;
  for (const status of actor.effects) {
    if (!isStatusActive(status, time)) continue;
    const result = handlerOf(status.behavior).modifyDamage?.(status.behavior, dealt, damageType, sourceName);
    if (!result) continue;
    dealt = result.dealt;
    if (result.consume) consumed.add(status.id);
  }
  if (consumed.size > 0 && damage > 0) removeStatuses(actor, consumed);
  return dealt;
}

export function surviveLethal(actor: StatusActor, time: number): boolean {
  const survivor = actor.effects.find(status => isStatusActive(status, time) && handlerOf(status.behavior).survivesLethal?.(status.behavior) === true);
  if (!survivor) return false;
  removeInstance(actor, survivor);
  return true;
}

export function cleanseAtFullHp(actor: StatusActor, time: number): void {
  if (!actor.alive || actor.hp < actor.maxHp) return;
  removeWhere(actor, status => isStatusActive(status, time) && handlerOf(status.behavior).cleansesAtFullHp?.(status.behavior) === true);
}

export function isKnockbackImmune(actor: StatusActor, time: number): boolean {
  return actor.effects.some(status => isStatusActive(status, time) && handlerOf(status.behavior).blocksKnockback === true);
}

export function modifyKnockback(actor: StatusActor, knockback: Knockback, origin: Vec2, time: number): Knockback {
  const modifier = actor.effects.find(status => isStatusActive(status, time) && handlerOf(status.behavior).modifyKnockback !== undefined);
  if (!modifier) return knockback;
  removeInstance(actor, modifier);
  return handlerOf(modifier.behavior).modifyKnockback!(modifier.behavior, actor, knockback, origin);
}

export function requiredKnockbackFacing(actor: StatusActor, time: number): "away" | "toward" | undefined {
  for (const status of actor.effects) {
    const requiredFacing = handlerOf(status.behavior).requiredFacing;
    if (requiredFacing && isStatusActive(status, time)) return requiredFacing(status.behavior);
  }
  return undefined;
}

export function movementSpeedMultiplier(actor: Pick<StatusActor, "effects">, time: number): number {
  let multiplier = 1;
  for (const status of actor.effects) {
    const speed = handlerOf(status.behavior).speedMultiplier;
    if (speed && isStatusActive(status, time)) multiplier *= speed(status.behavior);
  }
  return multiplier;
}

export function isInputDisabled(actor: Pick<StatusActor, "effects">, time: number): boolean {
  return actor.effects.some(status => isStatusActive(status, time) && handlerOf(status.behavior).disablesInput === true);
}

export type MovementControl = { frozen: boolean; forcedWalk?: StatusInstance };

export function movementControl(actor: StatusActor, time: number): MovementControl {
  const active = activeStatuses(actor, time);
  if (active.some(status => handlerOf(status.behavior).freezes === true)) return { frozen: true };
  return { frozen: false, forcedWalk: active.find(status => handlerOf(status.behavior).forcedWalk !== undefined) };
}

export function resolveForcedWalk(actor: StatusActor, status: StatusInstance, env: ApplyEnv & { log(mechanic: string, actorId: string, event: "hit"): void }): Vec2 | undefined {
  const walk = handlerOf(status.behavior).forcedWalk!(status);
  const target = env.actors.find(candidate => candidate.id === walk.targetId && candidate.alive);
  if (!target) return undefined;
  if (length(sub(target.pos, actor.pos)) > walk.radius) return target.pos;
  env.damage(target, walk.damage, walk.damageType, statusSource(status));
  removeStatus(actor, status.id);
  env.log(status.name, target.id, "hit");
  return undefined;
}

export function activeStatuses(actor: Pick<StatusActor, "effects">, time: number): StatusInstance[] {
  return actor.effects.filter(status => isStatusActive(status, time));
}

export function hasActiveStatus(actor: Pick<StatusActor, "effects">, ref: string, time: number): boolean {
  return actor.effects.some(status => status.ref === ref && isStatusActive(status, time));
}

export function hasActiveStatusNamed(actor: Pick<StatusActor, "effects">, name: string, time: number): boolean {
  return actor.effects.some(status => status.name === name && isStatusActive(status, time));
}

export function remainingTime(actor: Pick<StatusActor, "effects">, ref: string, time: number): number {
  let remaining = 0;
  for (const status of actor.effects) {
    if (status.ref === ref) remaining = Math.max(remaining, status.appliedAt + status.duration - time);
  }
  return remaining;
}

export function urgentSlot(actor: Pick<StatusActor, "effects">): number | undefined {
  let urgent: StatusInstance | undefined;
  for (const status of actor.effects) {
    if (handlerOf(status.behavior).displaySlot === undefined) continue;
    if (!urgent || status.appliedAt + status.duration < urgent.appliedAt + urgent.duration) urgent = status;
  }
  return urgent ? handlerOf(urgent.behavior).displaySlot!(urgent) : undefined;
}

export function statusIcon(status: StatusInstance): StatusIcon {
  return handlerOf(status.behavior).icon?.(status) ?? { glyph: status.kind === "buff" ? "▲" : "●" };
}

export function sortForDisplay(statuses: readonly StatusInstance[], include: (status: StatusInstance) => boolean): StatusInstance[] {
  return statuses
    .map((status, index) => ({ status, index }))
    .filter(entry => include(entry.status))
    .sort((a, b) => {
      if (a.status.priority !== b.status.priority) return a.status.priority ? -1 : 1;
      const aSlot = handlerOf(a.status.behavior).displaySlot;
      const bSlot = handlerOf(b.status.behavior).displaySlot;
      if (aSlot && bSlot) return (aSlot(a.status) ?? a.index) - (bSlot(b.status) ?? b.index);
      return a.index - b.index;
    })
    .map(entry => entry.status);
}
