import type { AOEShape } from "@effects";
import type { Vec2 } from "@shared/math";
import { dot, length, normalize, sub } from "@shared/math";
import { cos, sin } from "@shared/dmath";
import type {
  ApplyEnv,
  BehaviorOf,
  BurstFollowUp,
  CircleOrDonut,
  DamageType,
  Knockback,
  StatusActor,
  StatusBehavior,
  StatusBehaviorKind,
  StatusIcon,
  StatusInstance,
  StatusRuntime,
  StatusServices,
  StatusSource,
  StatusSpec,
} from "./types";
import { activeDuring, expiresWithin, removeInstance, replaceInstance, statusSource } from "./state";
import { requireStatus } from "./resolve";

type Instance<K extends StatusBehaviorKind> = StatusInstance & { behavior: BehaviorOf<K> };

export type Reapply = (spec: StatusSpec, id?: string) => void;

export type ExpiryContext = {
  resolvedCrystalFollowUps: Set<string>;
  resolvedPairedSpreadStacks: Set<string>;
  apply: (actor: StatusActor, spec: StatusSpec, id: string) => void;
};

export type BehaviorHandler<K extends StatusBehaviorKind> = {
  reapplyKey?: (behavior: BehaviorOf<K>) => string;
  onReapply?: (existing: Instance<K>, incoming: StatusSpec, actor: StatusActor, env: ApplyEnv, reapply: Reapply) => "apply" | "handled";
  onApply?: (status: Instance<K>, actor: StatusActor, env: ApplyEnv) => StatusRuntime;
  onTick?: (status: Instance<K>, actor: StatusActor, services: StatusServices, acted: boolean) => void;
  onExpiry?: (status: Instance<K>, actor: StatusActor, services: StatusServices, expiry: ExpiryContext) => void;
  onMechanicHit?: (status: Instance<K>, mechanic: string, actor: StatusActor, env: ApplyEnv, reapply: Reapply) => void;
  modifyDamage?: (behavior: BehaviorOf<K>, dealt: number, damageType: DamageType, sourceName: string) => { dealt: number; consume?: boolean };
  survivesLethal?: (behavior: BehaviorOf<K>) => boolean;
  cleansesAtFullHp?: (behavior: BehaviorOf<K>) => boolean;
  modifyKnockback?: (behavior: BehaviorOf<K>, actor: StatusActor, knockback: Knockback, origin: Vec2) => Knockback;
  requiredFacing?: (behavior: BehaviorOf<K>) => "away" | "toward";
  blocksKnockback?: boolean;
  speedMultiplier?: (behavior: BehaviorOf<K>) => number;
  disablesInput?: boolean;
  freezes?: boolean;
  forcedWalk?: (status: Instance<K>) => { targetId?: string; radius: number; damage: number; damageType: DamageType };
  slot?: { stamp: (behavior: BehaviorOf<K>, direction: [number, number]) => BehaviorOf<K> };
  displaySlot?: (status: Instance<K>) => number | undefined;
  icon?: (status: Instance<K>) => StatusIcon;
};

type BehaviorRegistry = { [K in StatusBehaviorKind]: BehaviorHandler<K> };

export const BEHAVIORS: BehaviorRegistry = {
  none: {},
  vuln: {
    modifyDamage: (behavior, dealt, damageType) => behavior.damageType === damageType
      ? { dealt: dealt * behavior.multiplier, consume: true }
      : { dealt },
    icon: () => ({ glyph: "▼" }),
  },
  mitigation: {
    modifyDamage: (behavior, dealt, damageType) => ({
      dealt: behavior.damageType === undefined || behavior.damageType === damageType ? dealt * behavior.multiplier : dealt,
    }),
  },
  dot: {
    onTick: dotOnTick,
    icon: status => ({ glyph: status.behavior.condition === "moving" ? "🔥" : status.behavior.condition === "idle" ? "❄" : "🩸" }),
  },
  confusion: {
    onApply: (_status, actor, env) => ({ lockedTargetId: closestOtherActor(actor, env.actors)?.id }),
    disablesInput: true,
    forcedWalk: status => ({ targetId: status.lockedTargetId, ...status.behavior }),
    icon: () => ({ src: "confuse.png" }),
  },
  sleep: {
    disablesInput: true,
    freezes: true,
    icon: () => ({ src: "sleep.png" }),
  },
  burstSpread: { onExpiry: burstSpreadOnExpiry },
  effectBurst: { onExpiry: effectBurstOnExpiry },
  twister: { onExpiry: twisterOnExpiry },
  carrierGaze: { onExpiry: carrierGazeOnExpiry },
  reverseCarrierGaze: { onExpiry: reverseCarrierGazeOnExpiry },
  pairedSpreadStack: { onExpiry: pairedSpreadStackOnExpiry },
  effectCheck: { onExpiry: effectCheckOnExpiry },
  plant: {
    onExpiry: plantOnExpiry,
    slot: { stamp: (behavior, direction) => ({ ...behavior, direction }) },
    displaySlot: status => status.plantSlot,
    icon: status => ({ src: teleportentIcon(status.behavior.direction) }),
  },
  directionalKnockback: {
    modifyKnockback: directionalKnockback,
    requiredFacing: behavior => behavior.requiredFacing,
    icon: status => ({ src: `${status.behavior.requiredFacing === "toward" ? "headwind" : "tailwind"}.png` }),
  },
  escalating: {
    reapplyKey: behavior => behavior.escalationKey,
    onReapply: (existing, _incoming, actor, env, reapply) => {
      const behavior = existing.behavior;
      if (behavior.escalateDamage !== undefined) env.damage(actor, behavior.escalateDamage, behavior.escalateDamageType ?? "true", statusSource(existing));
      if (behavior.escalateTo !== undefined) {
        removeInstance(actor, existing);
        reapply(requireStatus(behavior.escalateTo));
      }
      return "handled";
    },
  },
  alternating: {
    reapplyKey: behavior => behavior.alternationKey,
    onReapply: (existing, incoming, actor, env, reapply) => {
      if (existing.name !== incoming.name) {
        removeInstance(actor, existing);
        return "apply";
      }
      const behavior = existing.behavior;
      if (behavior.repeatDamage !== undefined) env.damage(actor, behavior.repeatDamage, behavior.repeatDamageType ?? "true", statusSource(existing));
      if (behavior.repeatApply !== undefined) reapply(requireStatus(behavior.repeatApply));
      return "handled";
    },
  },
  expiryDamage: {
    onExpiry: expiryDamageOnExpiry,
    survivesLethal: behavior => behavior.surviveLethal === true,
    cleansesAtFullHp: behavior => behavior.cleanseAtFullHp === true,
  },
  elementCleanse: {
    onExpiry: expiryDamageOnExpiry,
    onMechanicHit: elementCleanseOnHit,
  },
  elementVuln: {
    modifyDamage: (behavior, dealt, _damageType, sourceName) => ({ dealt: sourceName === behavior.mechanic ? dealt * behavior.multiplier : dealt }),
  },
  motionCheck: { onExpiry: motionCheckOnExpiry },
  movementSpeed: { speedMultiplier: behavior => behavior.multiplier },
  knockbackImmunity: { blocksKnockback: true },
};

export function handlerOf(behavior: StatusBehavior): BehaviorHandler<StatusBehaviorKind> {
  return BEHAVIORS[behavior.kind] as BehaviorHandler<StatusBehaviorKind>;
}

function circleOrDonut(shape: CircleOrDonut | undefined, center: Vec2, radius: number, inner: number | undefined): AOEShape {
  return shape === "donut"
    ? { kind: "donut", center, inner: inner!, outer: radius }
    : { kind: "circle", center, radius };
}

function dotOnTick(status: Instance<"dot">, actor: StatusActor, services: StatusServices, acted: boolean): void {
  const behavior = status.behavior;
  const activeDt = activeDuring(status, services.previousTime, services.time);
  if (activeDt <= 0) return;
  const ticks = behavior.condition === "always"
    || (behavior.condition === "moving" && acted)
    || (behavior.condition === "idle" && !acted);
  if (!ticks || !actor.alive) return;
  actor.hp = Math.max(0, actor.hp - behavior.dps * activeDt);
  if (actor.hp <= 0) {
    actor.alive = false;
    services.log(status.name, actor.id, "hit");
    services.recordDeath(actor, statusSource(status));
  }
}

function burstSpreadOnExpiry(status: Instance<"burstSpread">, actor: StatusActor, services: StatusServices, expiry: ExpiryContext): void {
  const behavior = status.behavior;
  const source = statusSource(status);
  const selfShape = circleOrDonut(behavior.selfShape, actor.pos, behavior.radius, behavior.selfInner);
  const knockback = behavior.knockbackDistance > 0 ? { distance: behavior.knockbackDistance, origin: actor.pos, exemptId: actor.id } : undefined;
  services.hitShape(selfShape, behavior.damage, behavior.damageType, source, knockback);
  services.showAoe(`${status.id}-self`, status.name, selfShape);
  const followUp = behavior.followUp;
  if (!followUp) return;
  if (followUp.originCrystal !== undefined) {
    const key = `${status.name}:${followUp.originCrystal}`;
    if (expiry.resolvedCrystalFollowUps.has(key)) return;
    expiry.resolvedCrystalFollowUps.add(key);
    services.scheduleFollowUp({
      id: status.id,
      t: services.time + 1,
      name: status.name,
      avoidable: status.avoidable,
      originCrystal: followUp.originCrystal,
      followUp,
    });
    return;
  }
  resolveBurstFollowUp(services, status.id, source, followUp, actor.pos, actor.id);
}

export function resolveBurstFollowUp(services: StatusServices, id: string, source: StatusSource, followUp: BurstFollowUp, origin: Vec2, excludeId?: string): void {
  for (const target of services.selectTargets(origin, followUp.mode, followUp.count, excludeId)) {
    const shape = circleOrDonut(followUp.shape, target.pos, followUp.radius, followUp.inner);
    const knockback = followUp.knockbackDistance !== undefined && followUp.knockbackDistance > 0
      ? { distance: followUp.knockbackDistance, origin: target.pos }
      : undefined;
    services.hitShape(shape, followUp.damage, followUp.damageType, source, knockback);
    services.showAoe(`${id}-fu-${target.id}`, source.name, shape);
  }
}

function effectBurstOnExpiry(status: Instance<"effectBurst">, actor: StatusActor, services: StatusServices): void {
  const behavior = status.behavior;
  const shape = circleOrDonut(behavior.shape, actor.pos, behavior.radius, behavior.innerRadius);
  services.hitShape(shape, behavior.damage, behavior.damageType, statusSource(status));
  services.showAoe(`${status.id}-burst`, status.name, shape);
}

function twisterOnExpiry(status: Instance<"twister">, actor: StatusActor, services: StatusServices): void {
  const behavior = status.behavior;
  const inverted = behavior.questionMark ?? (behavior.rng ? services.randFloat() < 0.5 : false);
  const center = { x: actor.pos.x, z: actor.pos.z };
  services.scheduleTwister({
    id: status.id,
    t: services.time + behavior.delay,
    name: status.name,
    avoidable: status.avoidable,
    shape: circleOrDonut(inverted ? behavior.hiddenShape : behavior.shownShape, center, behavior.radius, behavior.innerRadius),
    damage: behavior.damage,
    damageType: behavior.damageType,
  });
}

function carrierGazeOnExpiry(status: Instance<"carrierGaze">, actor: StatusActor, services: StatusServices): void {
  const behavior = status.behavior;
  const shape: AOEShape = {
    kind: "cone",
    origin: actor.pos,
    direction: { x: sin(actor.facing), z: cos(actor.facing) },
    ...behavior.cone,
  };
  services.hitShape(shape, behavior.damage, behavior.damageType, statusSource(status));
  services.showAoe(`${status.id}-cone`, status.name, shape);
}

function reverseCarrierGazeOnExpiry(status: Instance<"reverseCarrierGaze">, actor: StatusActor, services: StatusServices): void {
  const behavior = status.behavior;
  const halfAngle = behavior.coneHalfAngle ?? Math.PI / 2;
  for (const target of services.actors) {
    if (!target.alive || target.id === actor.id) continue;
    if (services.isLookingAt(target, actor.pos, halfAngle)) continue;
    services.damage(target, behavior.damage, behavior.damageType, statusSource(status));
    services.log(status.name, target.id, "hit");
  }
}

function pairedSpreadStackOnExpiry(status: Instance<"pairedSpreadStack">, _actor: StatusActor, services: StatusServices, expiry: ExpiryContext): void {
  const behavior = status.behavior;
  if (expiry.resolvedPairedSpreadStacks.has(behavior.key)) return;
  expiry.resolvedPairedSpreadStacks.add(behavior.key);
  const carriers = services.actors.flatMap(carrier => carrier.effects
    .filter(candidate => candidate.behavior.kind === "pairedSpreadStack"
      && candidate.behavior.key === behavior.key
      && expiresWithin(candidate, services.previousTime, services.time))
    .map(candidate => ({ carrier, role: (candidate.behavior as BehaviorOf<"pairedSpreadStack">).role })));
  const source = statusSource(status);
  for (const { carrier } of carriers.filter(entry => entry.role === "spread")) {
    const shape: AOEShape = { kind: "circle", center: carrier.pos, radius: behavior.spread.radius };
    services.hitShape(shape, behavior.spread.damage, behavior.damageType, source);
    services.showAoe(`${status.id}-spread-${carrier.id}`, status.name, shape);
  }
  for (const { carrier } of carriers.filter(entry => entry.role === "stack")) {
    const shape: AOEShape = { kind: "circle", center: carrier.pos, radius: behavior.stack.radius };
    services.resolveStack(shape, behavior.stack, behavior.damageType, source);
    services.showAoe(`${status.id}-stack-${carrier.id}`, status.name, shape);
  }
}

function effectCheckOnExpiry(status: Instance<"effectCheck">, actor: StatusActor, services: StatusServices): void {
  const behavior = status.behavior;
  const [left, right] = behavior.compare.map(group => actor.effects.find(candidate => candidate.group === group)?.name);
  const passes = left !== undefined && right !== undefined
    && (behavior.expect === "matches" ? left === right : left !== right);
  if (passes) {
    services.log(status.name, actor.id, "cleared");
    return;
  }
  services.damage(actor, behavior.failureDamage, behavior.failureDamageType, statusSource(status));
  services.log(status.name, actor.id, "hit");
}

function plantOnExpiry(status: Instance<"plant">, actor: StatusActor, services: StatusServices): void {
  const behavior = status.behavior;
  services.placeTrap({
    id: `plant-${actor.id}-${status.id}`,
    name: status.name,
    pos: { x: actor.pos.x, z: actor.pos.z },
    radius: behavior.radius,
    direction: { x: behavior.direction[0], z: behavior.direction[1] },
    distance: behavior.distance,
    preDelay: behavior.tpDelay,
    armedAt: services.time + behavior.armDelay,
    expireAt: services.time + behavior.armDelay + behavior.duration,
  });
}

function expiryDamageOnExpiry(status: Instance<"expiryDamage" | "elementCleanse">, actor: StatusActor, services: StatusServices): void {
  const behavior = status.behavior;
  services.damage(actor, behavior.expiryDamage, behavior.expiryDamageType, statusSource(status));
  if (!actor.alive) services.log(status.name, actor.id, "hit");
}

function motionCheckOnExpiry(status: Instance<"motionCheck">, actor: StatusActor, services: StatusServices, expiry: ExpiryContext): void {
  const behavior = status.behavior;
  const moved = (actor.lastMotionAt ?? -Infinity) >= services.time - behavior.window;
  if (behavior.required === "move" ? moved : !moved) return;
  const airtime = services.launch(actor, behavior.failureKnockupHeight);
  expiry.apply(actor, requireStatus("motion_check_landing", {
    name: status.name,
    avoidable: status.avoidable,
    duration: airtime,
    behavior: { expiryDamage: behavior.failureDamage, expiryDamageType: behavior.failureDamageType },
  }), `${status.id}-landing`);
}

function elementCleanseOnHit(status: Instance<"elementCleanse">, mechanic: string, actor: StatusActor, _env: ApplyEnv, reapply: Reapply): void {
  const ref = status.behavior.elements[mechanic];
  if (ref === undefined || status.cleansedElements?.includes(mechanic)) return;
  const cleansedElements = [...(status.cleansedElements ?? []), mechanic];
  const stacks = Object.keys(status.behavior.elements).length - cleansedElements.length;
  if (stacks <= 0) removeInstance(actor, status);
  else replaceInstance(actor, status, { ...status, cleansedElements, stacks });
  reapply(requireStatus(ref), `${status.id}-${ref}`);
}

function directionalKnockback(behavior: BehaviorOf<"directionalKnockback">, actor: StatusActor, knockback: Knockback, origin: Vec2): Knockback {
  const away = sub(actor.pos, origin);
  const direction = length(away) > 0 ? normalize(away) : { x: 1, z: 0 };
  const facing = { x: sin(actor.facing), z: cos(actor.facing) };
  const isFacingAway = dot(facing, direction) > 0;
  const correct = behavior.requiredFacing === "away" ? isFacingAway : !isFacingAway;
  return { ...knockback, distance: correct ? behavior.distance : behavior.doubledDistance };
}

function closestOtherActor(self: StatusActor, actors: readonly StatusActor[]): StatusActor | null {
  let best: StatusActor | null = null;
  let bestDist = Infinity;
  for (const actor of actors) {
    if (actor === self || actor.id === self.id || !actor.alive) continue;
    const dist = length(sub(actor.pos, self.pos));
    if (dist < bestDist) {
      bestDist = dist;
      best = actor;
    }
  }
  return best;
}

function teleportentIcon([x, z]: [number, number]): string {
  if (Math.abs(x) > Math.abs(z)) return x >= 0 ? "teleportent_right.png" : "teleportent_left.png";
  return z >= 0 ? "teleportent_up.png" : "teleportent_down.png";
}
