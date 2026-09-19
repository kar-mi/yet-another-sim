// Stateless simulation helpers shared across the per-mechanic systems. Every function here takes
// its inputs explicitly (no hidden tick state) so it can be reused freely and unit-tested in
// isolation. The seeded RNG is always passed in as a `randInt`/`randFloat` callback.

import type {
  Player,
  Role,
  Boss,
  PositionalArc,
  LineLinkTarget,
  DamageType,
  StatusEffect,
  EffectSpec,
  EffectBehavior,
  Intent,
  ActiveMechanic,
  Knockback,
  AOEShape,
} from "@shared/types";
import type { Vec2 } from "@shared/math";
import { sub, scale, normalize, length, dot } from "@shared/math";
import { GRAVITY, KNOCKBACK_FRICTION, INTERCEPT_THRESHOLD } from "@shared/constants";
import { sin, cos, acos } from "@shared/dmath";
import { COMBAT_LIFECYCLE_REGISTRY } from "../status/combatLifecycle";
import { resolveEffectRef } from "../status/registry";
import { effectSource, recordAvoidableHit, recordDeath, type DamageContext, type DamageSource } from "./damageLog";

export function topThreatTarget(players: Player[], threat: Record<string, number>): string | null {
  let best: string | null = null;
  let bestThreat = -Infinity;
  for (const p of players) {
    if (!p.alive) continue;
    const t = threat[p.id] ?? 0;
    if (t > bestThreat || (t === bestThreat && best !== null && p.id < best)) {
      best = p.id;
      bestThreat = t;
    }
  }
  return best;
}

export function selectTargetPlayer(
  players: Player[],
  origin: Vec2,
  mode: "closest" | "furthest",
  role?: Role,
): Player | null {
  let best: Player | null = null;
  let bestDist = mode === "closest" ? Infinity : -Infinity;
  for (const p of players) {
    if (!p.alive || (role && p.role !== role)) continue;
    const dx = p.pos.x - origin.x, dz = p.pos.z - origin.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (mode === "closest" ? d < bestDist : d > bestDist) { bestDist = d; best = p; }
  }
  return best;
}

// Select the N nearest (or furthest) alive, optionally role-filtered players to `origin`, ordered
// by distance. Used by targeted events with `count` > 1 (e.g. a spread on the closest few).
export function selectTargetPlayers(
  players: Player[],
  origin: Vec2,
  mode: "closest" | "furthest",
  count: number,
  role?: Role,
): Player[] {
  return players
    .filter(p => p.alive && (!role || p.role === role))
    .map(p => {
      const dx = p.pos.x - origin.x, dz = p.pos.z - origin.z;
      return { p, d: Math.sqrt(dx * dx + dz * dz) };
    })
    .sort((a, b) => (mode === "closest" ? a.d - b.d : b.d - a.d))
    .slice(0, count)
    .map(c => c.p);
}

export function selectLineLinkTargets(
  players: Player[],
  origin: Vec2,
  target: LineLinkTarget,
): Player[] {
  const limit = target.count ?? target.playerIds?.length ?? 1;
  return players
    .filter(p => {
      if (!p.alive) return false;
      if (target.roles && !target.roles.includes(p.role)) return false;
      if (target.playerIds && !target.playerIds.includes(p.id)) return false;
      return true;
    })
    .map(p => ({ player: p, distance: length(sub(p.pos, origin)) }))
    .sort((a, b) => target.mode === "closest" ? a.distance - b.distance : b.distance - a.distance)
    .slice(0, limit)
    .map(candidate => candidate.player);
}

// Applies `damage` to a player, factoring in matching vuln debuffs (which multiply
// the hit and are then consumed when the base damage is > 0). Respects invincibility.
// `source` also drives replay recording; a hit on an already-dead player records nothing.
export function applyMechanicDamage(dc: DamageContext, player: Player, damage: number, damageType: DamageType, source: DamageSource): void {
  const time = dc.time;
  const wasAlive = player.alive;
  const hpBefore = player.hp;
  const matchingVulnIds = new Set<string>();
  let dealt = damage;
  for (const effect of player.effects) {
    if (!isEffectActiveAt(effect, time)) continue;
    const result = COMBAT_LIFECYCLE_REGISTRY[effect.behavior.kind].modifyDamage?.(effect, dealt, damageType, source.name);
    if (!result) continue;
    dealt = result.dealt;
    if (result.consume) matchingVulnIds.add(effect.id);
  }
  if (matchingVulnIds.size > 0 && damage > 0) {
    player.effects = player.effects.filter(effect => !matchingVulnIds.has(effect.id));
  }
  if (!player.invincible) {
    player.hp = Math.max(0, player.hp - dealt);
  }
  if (wasAlive) recordAvoidableHit(dc, player, source, hpBefore - player.hp);
  if (!player.invincible && player.hp <= 0) {
    resolveLethalHit(dc, player, source, wasAlive);
  }
}

// Applies an explicitly lethal mechanic punishment. Invincibility and one-hit survivor effects
// still apply, but damage modifiers cannot turn the punishment into an ordinary nonlethal hit.
export function applyMechanicLethal(dc: DamageContext, player: Player, source: DamageSource): void {
  if (player.invincible) return;
  const wasAlive = player.alive;
  const hpBefore = player.hp;
  player.hp = 0;
  if (wasAlive) recordAvoidableHit(dc, player, source, hpBefore);
  resolveLethalHit(dc, player, source, wasAlive);
}

function resolveLethalHit(dc: DamageContext, player: Player, source: DamageSource, wasAlive: boolean): void {
  const time = dc.time;
  const survivor = player.effects.find(e => isEffectActiveAt(e, time) && COMBAT_LIFECYCLE_REGISTRY[e.behavior.kind].onLethal?.(e, player) === true);
  if (survivor) {
    player.hp = 1;
    player.effects = player.effects.filter(e => e !== survivor);
  } else {
    player.alive = false;
    if (wasAlive) recordDeath(dc, player, source);
  }
}

// Whether the player's bearing from the boss falls within a facing-relative arc.
export function inPositionalArc(boss: Boss, pos: Vec2, arc: PositionalArc): boolean {
  const to = sub(pos, boss.pos);
  if (length(to) < 1e-6) return true; // on top of the boss: always inside
  // Arc center direction in world space (0 = +Z, clockwise), then unsigned angular distance.
  const centerWorld = boss.facing + arc.center;
  const centerVec = { x: sin(centerWorld), z: cos(centerWorld) };
  const cosAng = Math.max(-1, Math.min(1, dot(normalize(to), centerVec)));
  return acos(cosAng) <= arc.width / 2;
}

// Gaze: is the player facing the source within the given half-angle? Player facing is a radian
// angle (0 = +Z), so the facing direction vector is { sin, cos }. Compared against the unit
// vector from the player to the source. Default half-angle PI/2 => the whole front hemisphere.
export function isLookingAt(facing: number, from: Vec2, to: Vec2, halfAngle: number): boolean {
  const d = sub(to, from);
  if (length(d) < 1e-6) return true; // on top of the source: always counts as looking at it
  const face = { x: sin(facing), z: cos(facing) };
  const cosAng = Math.max(-1, Math.min(1, dot(normalize(d), face)));
  return acos(cosAng) <= halfAngle;
}

function isOnTetherLine(pPos: Vec2, src: Vec2, tgt: Vec2): boolean {
  const dx = tgt.x - src.x, dz = tgt.z - src.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 0.001) return false;
  const t = ((pPos.x - src.x) * dx + (pPos.z - src.z) * dz) / lenSq;
  if (t <= 0.1 || t >= 0.9) return false;
  const cx = src.x + t * dx, cz = src.z + t * dz;
  const d2 = ((pPos.x - cx) * (pPos.x - cx)) + ((pPos.z - cz) * (pPos.z - cz));
  return d2 < INTERCEPT_THRESHOLD * INTERCEPT_THRESHOLD;
}

export function findInterceptor(players: Player[], src: Vec2, tgt: Vec2, excludeId: string): Player | null {
  for (const p of players) {
    if (!p.alive || p.id === excludeId) continue;
    if (isOnTetherLine(p.pos, src, tgt)) return p;
  }
  return null;
}

export function shapeOrigin(shape: AOEShape): Vec2 {
  if (shape.kind === "circle" || shape.kind === "donut") return shape.center;
  // A polygon has no authored anchor, so knockbacks and follow-ups push from its vertex average.
  if (shape.kind === "polygon") {
    const sum = shape.vertices.reduce((acc, v) => ({ x: acc.x + v.x, z: acc.z + v.z }), { x: 0, z: 0 });
    return { x: sum.x / shape.vertices.length, z: sum.z / shape.vertices.length };
  }
  return shape.origin;
}

export function didAct(intent: Intent | undefined): boolean {
  return !!intent && (length(intent.move) > 0 || intent.jump === true || intent.sprint === true);
}

export function isEffectActiveAt(effect: StatusEffect, time: number): boolean {
  return effect.appliedAt + effect.duration > time;
}

// Whether an aoe's per-player filters let it hit this player: a `players` list (deals) and
// `onlyCarriers` (the player must carry an active effect named like the aoe). Position is not checked.
export function aoeCanHitPlayer(mechanic: Pick<ActiveMechanic, "name" | "onlyCarriers" | "players">, player: Player, time: number): boolean {
  const carries = !mechanic.onlyCarriers || player.effects.some(e => e.name === mechanic.name && isEffectActiveAt(e, time));
  const targeted = !mechanic.players || mechanic.players.includes(player.id);
  return carries && targeted;
}

export function effectActiveDt(effect: StatusEffect, previousTime: number, time: number): number {
  const activeStart = Math.max(previousTime, effect.appliedAt);
  const activeEnd = Math.min(time, effect.appliedAt + effect.duration);
  return Math.max(0, activeEnd - activeStart);
}

export function applyKnockback(player: Player, knockback: Knockback, origin: Vec2, time: number): void {
  player.botWaypointResumeAfter = time;
  const away = sub(player.pos, origin);
  const dir = length(away) > 0 ? normalize(away) : { x: 1, z: 0 }; // player on origin: arbitrary dir
  let { distance, height } = knockback;

  const modifier = player.effects.find(e => isEffectActiveAt(e, time) && COMBAT_LIFECYCLE_REGISTRY[e.behavior.kind].modifyKnockback !== undefined);
  if (modifier) {
    ({ distance, height } = COMBAT_LIFECYCLE_REGISTRY[modifier.behavior.kind].modifyKnockback!(modifier, player, knockback, origin, time));
    player.effects = player.effects.filter(e => e !== modifier);
  }
  if (height > 0) {
    // Projectile arc: rise to peak `height`, travel `distance` horizontally over the flight.
    const vUp = Math.sqrt(2 * GRAVITY * height);
    const flightTime = (2 * vUp) / GRAVITY;
    player.verticalVelocity = vUp;
    player.knockbackVelocity = scale(dir, distance / flightTime);
  } else {
    // Ground slide: friction brings it to rest after exactly `distance`.
    player.knockbackVelocity = scale(dir, Math.sqrt(2 * KNOCKBACK_FRICTION * distance));
  }
}

function effectReapplicationKey(behavior: EffectBehavior): string | undefined {
  if (behavior.kind === "escalating") return behavior.escalationKey;
  if (behavior.kind === "alternating") return behavior.alternationKey;
  return undefined;
}

export function applyEffect(dc: DamageContext, player: Player, spec: EffectSpec, id: string, players: Player[], plantSlot?: number, limitCutNumber?: number): void {
  const time = dc.time;
  const incoming = spec.behavior;
  const key = effectReapplicationKey(incoming);
  const existing = key === undefined ? undefined : player.effects.find(effect =>
    isEffectActiveAt(effect, time)
    && effect.behavior.kind === incoming.kind
    && effectReapplicationKey(effect.behavior) === key
  );
  if (existing) {
    const behavior = existing.behavior;
    if (behavior.kind === "alternating" && existing.name !== spec.name) {
      player.effects = player.effects.filter(effect => effect !== existing);
    } else if (behavior.kind === "escalating" || behavior.kind === "alternating") {
      const damage = behavior.kind === "escalating" ? behavior.escalateDamage : behavior.repeatDamage;
      const damageType = behavior.kind === "escalating" ? behavior.escalateDamageType : behavior.repeatDamageType;
      const nextRef = behavior.kind === "escalating" ? behavior.escalateTo : behavior.repeatApply;
      if (damage !== undefined) applyMechanicDamage(dc, player, damage, damageType ?? "true", effectSource(existing));
      if (nextRef !== undefined) {
        if (behavior.kind === "escalating") player.effects = player.effects.filter(effect => effect !== existing);
        const next = resolveEffectRef({ ref: nextRef });
        if (next) applyEffect(dc, player, next, id, players, plantSlot, limitCutNumber);
      }
      return;
    }
  }

  const effect: StatusEffect = {
    id,
    name: spec.name,
    kind: spec.kind,
    avoidable: spec.avoidable,
    appliedAt: time,
    duration: spec.duration,
    stacks: spec.stacks,
    behavior: spec.behavior,
    visibility: spec.visibility,
    priority: spec.priority,
    group: spec.group,
    showTimer: spec.showTimer,
    icon: spec.icon,
    marker: spec.marker,
    markerIcon: spec.markerIcon,
    markerIconScale: spec.markerIconScale,
    ring: spec.ring,
    countdown: spec.countdown,
    plantSlot,
    limitCutNumber,
  };
  if (spec.group) player.effects = player.effects.filter(existing =>
    !isEffectActiveAt(existing, time) || existing.group !== spec.group);
  player.effects = [
    ...player.effects,
    {
      ...effect,
      ...COMBAT_LIFECYCLE_REGISTRY[spec.behavior.kind].onApply?.(effect, player, players, spec),
    },
  ];
}

export function consumeEffectStacks(player: Player, effectName: string, stacks: number, time: number): void {
  const effect = player.effects.find(e => e.name === effectName && isEffectActiveAt(e, time));
  if (!effect) return;
  if (effect.stacks === undefined || effect.stacks <= stacks) {
    player.effects = player.effects.filter(e => e !== effect);
  } else {
    effect.stacks -= stacks;
  }
}

function shuffledEffects(specs: EffectSpec[], randInt: (n: number) => number): EffectSpec[] {
  const shuffled = specs.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function balancedEffectOrders(specs: EffectSpec[], count: number, randInt: (n: number) => number): EffectSpec[][] {
  if (specs.length <= 1) return Array.from({ length: count }, () => specs.slice());
  const start = randInt(specs.length);
  const orders = Array.from({ length: count }, (_, index) => {
    const offset = (start + index) % specs.length;
    return [...specs.slice(offset), ...specs.slice(0, offset)];
  });
  for (let i = orders.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [orders[i], orders[j]] = [orders[j], orders[i]];
  }
  return orders;
}

export function effectsForMechanic(mechanic: ActiveMechanic, randInt: (n: number) => number): EffectSpec[] {
  if (!mechanic.applyEffects) return mechanic.applyEffect ? [mechanic.applyEffect] : [];
  const specs = mechanic.applyEffects.effects.slice();
  if (mechanic.applyEffects.order === "shuffle") return shuffledEffects(specs, randInt);
  return specs;
}

// A hit by mechanic `name` drops one stack from each active elementCleanse effect that lists it and
// hasn't cleansed it yet, applying that element's mapped effect. The effect is removed at 0 stacks.
export function cleanseElementStacks(dc: DamageContext, player: Player, name: string, players: Player[]): void {
  for (const effect of player.effects.slice()) {
    if (!isEffectActiveAt(effect, dc.time) || effect.behavior.kind !== "elementCleanse") continue;
    const ref = effect.behavior.elements[name];
    if (ref === undefined || effect.cleansedElements?.includes(name)) continue;
    effect.cleansedElements = [...(effect.cleansedElements ?? []), name];
    effect.stacks = Object.keys(effect.behavior.elements).length - effect.cleansedElements.length;
    if (effect.stacks <= 0) player.effects = player.effects.filter(e => e !== effect);
    const spec = resolveEffectRef({ ref });
    if (spec) applyEffect(dc, player, spec, `${effect.id}-${ref}`, players);
  }
}

// First active effect of a given behavior kind, or null.
export function activeEffectOfKind(player: Player, time: number, kind: EffectBehavior["kind"]): StatusEffect | null {
  for (const effect of player.effects) {
    if (isEffectActiveAt(effect, time) && effect.behavior.kind === kind) return effect;
  }
  return null;
}
