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
    if (effect.behavior.kind === "vuln" && effect.behavior.damageType === damageType) {
      dealt *= effect.behavior.multiplier;
      matchingVulnIds.add(effect.id);
    }
  }
  if (matchingVulnIds.size > 0 && damage > 0) {
    player.effects = player.effects.filter(effect => !matchingVulnIds.has(effect.id));
  }
  if (!player.invincible) {
    player.hp = Math.max(0, player.hp - dealt);
    if (player.hp <= 0) {
      const crust = player.effects.find(e => isEffectActiveAt(e, time) && e.behavior.kind === "primordialCrust");
      if (crust) {
        player.hp = 1;
        player.effects = player.effects.filter(e => e !== crust);
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
  const d2 = (pPos.x - cx) ** 2 + (pPos.z - cz) ** 2;
  return d2 < INTERCEPT_THRESHOLD ** 2;
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

  const dirKb = player.effects.find(
    e => e.behavior.kind === "directionalKnockback" && isEffectActiveAt(e, time)
  );
  if (dirKb) {
    const b = dirKb.behavior as Extract<EffectBehavior, { kind: "directionalKnockback" }>;
    const facingDir = { x: sin(player.facing), z: cos(player.facing) };
    const isFacingAway = dot(facingDir, dir) > 0;
    const correct = b.requiredFacing === "away" ? isFacingAway : !isFacingAway;
    distance = correct ? b.distance : b.doubledDistance;
    player.effects = player.effects.filter(e => e !== dirKb);
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

export function applyEffect(player: Player, spec: EffectSpec, time: number, id: string, players: Player[], plantSlot?: number): void {
  // A confusion debuff locks onto the closest other living player at apply time.
  let lockedTargetId: string | undefined;
  if (spec.behavior.kind === "confusion") {
    const target = closestOtherPlayer(player, players);
    lockedTargetId = target?.id;
  }
  player.effects = [...player.effects, {
    id,
    name: spec.name,
    kind: spec.kind,
    appliedAt: time,
    duration: spec.duration,
    behavior: spec.behavior,
    visibility: spec.visibility,
    icon: spec.icon,
    marker: spec.marker,
    markerIcon: spec.markerIcon,
    markerIconScale: spec.markerIconScale,
    lockedTargetId,
    plantSlot,
  }];
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

// Closest living player other than `self` (used to lock a confusion target).
function closestOtherPlayer(self: Player, players: Player[]): Player | null {
  let best: Player | null = null;
  let bestDist = Infinity;
  for (const p of players) {
    if (p === self || p.id === self.id || !p.alive) continue;
    const d = length(sub(p.pos, self.pos));
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

// First active effect of a given behavior kind, or null.
export function activeEffectOfKind(player: Player, time: number, kind: EffectBehavior["kind"]): StatusEffect | null {
  for (const effect of player.effects) {
    if (isEffectActiveAt(effect, time) && effect.behavior.kind === kind) return effect;
  }
  return null;
}
