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
export function applyMechanicDamage(player: Player, damage: number, damageType: DamageType, time: number): void {
  const matchingVulnIds = new Set<string>();
  let dealt = damage;
  for (const effect of player.effects) {
    if (!isEffectActiveAt(effect, time)) continue;
    const result = COMBAT_LIFECYCLE_REGISTRY[effect.behavior.kind].modifyDamage?.(effect, dealt, damageType);
    if (!result) continue;
    dealt = result.dealt;
    if (result.consume) matchingVulnIds.add(effect.id);
  }
  if (matchingVulnIds.size > 0 && damage > 0) {
    player.effects = player.effects.filter(effect => !matchingVulnIds.has(effect.id));
  }
  if (!player.invincible) {
    player.hp = Math.max(0, player.hp - dealt);
    if (player.hp <= 0) {
      const survivor = player.effects.find(e => isEffectActiveAt(e, time) && COMBAT_LIFECYCLE_REGISTRY[e.behavior.kind].onLethal?.(e, player) === true);
      if (survivor) {
        player.hp = 1;
        player.effects = player.effects.filter(e => e !== survivor);
      } else {
        player.alive = false;
      }
    }
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
  return shape.kind === "circle" || shape.kind === "donut" ? shape.center : shape.origin;
}

export function didAct(intent: Intent | undefined): boolean {
  return !!intent && (length(intent.move) > 0 || intent.jump === true || intent.sprint === true);
}

export function isEffectActiveAt(effect: StatusEffect, time: number): boolean {
  return effect.appliedAt + effect.duration > time;
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

export function applyEffect(player: Player, spec: EffectSpec, time: number, id: string, players: Player[], plantSlot?: number, limitCutNumber?: number): void {
  if (spec.behavior.kind === "escalating") {
    const incoming = spec.behavior;
    const existing = player.effects.find(effect =>
      isEffectActiveAt(effect, time)
      && effect.behavior.kind === "escalating"
      && effect.behavior.escalationKey === incoming.escalationKey
    );
    if (existing?.behavior.kind === "escalating") {
      if (existing.behavior.escalateDamage !== undefined) {
        applyMechanicDamage(player, existing.behavior.escalateDamage, existing.behavior.escalateDamageType ?? "true", time);
      }
      if (existing.behavior.escalateTo !== undefined) {
        player.effects = player.effects.filter(effect => effect !== existing);
        const next = resolveEffectRef({ ref: existing.behavior.escalateTo });
        if (next) applyEffect(player, next, time, id, players, plantSlot, limitCutNumber);
      }
      return;
    }
  }

  const effect: StatusEffect = {
    id,
    name: spec.name,
    kind: spec.kind,
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

// First active effect of a given behavior kind, or null.
export function activeEffectOfKind(player: Player, time: number, kind: EffectBehavior["kind"]): StatusEffect | null {
  for (const effect of player.effects) {
    if (isEffectActiveAt(effect, time) && effect.behavior.kind === kind) return effect;
  }
  return null;
}
