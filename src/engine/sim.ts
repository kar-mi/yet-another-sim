import type {
  World,
  Intents,
  Intent,
  LogEntry,
  ActiveMechanic,
  TetherSource,
  Player,
  StatusEffect,
  EffectSpec,
  PendingTargetedEvent,
  Role,
  ActiveLineLink,
  PendingLineLink,
  ActiveTower,
  PendingTower,
  ActiveChain,
  PendingChain,
  Knockback,
  DamageType,
  ActiveGroupMechanic,
  PendingGroupEvent,
  ActiveInverse,
  PendingInverse,
  ActiveGaze,
  PendingGaze,
  ActiveForcedMarch,
  PendingEffectBurst,
  Boss,
  PositionalArc,
  EffectBehavior,
} from "../shared/types";
import type { Vec2 } from "../shared/math";
import type { AOEShape } from "../shared/types";
import { add, sub, scale, normalize, length, dot } from "../shared/math";
import { pointInShape, isOnFloor } from "./shapes";
import { promotePending } from "./timeline";
import { nextRandom, randomInt } from "../shared/rng";

export const MOVE_SPEED = 6;
export const SPRINT_MULTIPLIER = 1.3;
export const JUMP_SPEED = 9;
export const GRAVITY = 24;
export const DEATH_FLOOR_Y = -10; // players die after falling this far below the arena floor
export const SPRINT_DURATION = 10;
export const SPRINT_COOLDOWN = 60;
export const ANTI_KB_DURATION = 5;    // seconds the anti-knockback buff negates knockback
export const ANTI_KB_COOLDOWN = 120;  // seconds before anti-knockback can be used again
export const PROVOKE_COOLDOWN = 30;   // seconds before a tank can provoke again
export const PROVOKE_LEAD = 1;        // threat set above the current max so the tank becomes target
export const KNOCKBACK_FRICTION = 40; // ground deceleration (units/s^2); v0 = sqrt(2*FRICTION*distance)

export const INITIAL_TANK_THREAT = 1; // seed so a tank starts as the boss's target

// Alive player with the highest threat; stable tiebreak by id. null if none alive.
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

const INTERCEPT_THRESHOLD = 2.0;
const TARGETED_LINGER = 0.7; // seconds a targeted bait's circle stays visible after it resolves
const TOWER_LINGER = 0.7; // seconds a tower stays visible after it resolves (success/failure flash)
const CHAIN_LINGER = 0.7; // seconds a chain stays visible after it breaks/bursts (outcome flash)
const LINE_LINK_LINGER = 0.7; // seconds a line link/statue stays visible after resolving

function selectTargetPlayer(
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

function selectLineLinkTargets(
  players: Player[],
  origin: Vec2,
  target: { mode: "closest" | "furthest"; roles?: Role[]; playerIds?: string[]; count?: number },
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
function applyMechanicDamage(player: Player, damage: number, damageType: DamageType, time: number): void {
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
    if (player.hp <= 0) player.alive = false;
  }
}

// Whether the player's bearing from the boss falls within a facing-relative arc.
function inPositionalArc(boss: Boss, pos: Vec2, arc: PositionalArc): boolean {
  const to = sub(pos, boss.pos);
  if (length(to) < 1e-6) return true; // on top of the boss: always inside
  // Arc center direction in world space (0 = +Z, clockwise), then unsigned angular distance.
  const centerWorld = boss.facing + arc.center;
  const centerVec = { x: Math.sin(centerWorld), z: Math.cos(centerWorld) };
  const cosAng = Math.max(-1, Math.min(1, dot(normalize(to), centerVec)));
  return Math.acos(cosAng) <= arc.width / 2;
}

// Gaze: is the player facing the source within the given half-angle? Player facing is a radian
// angle (0 = +Z), so the facing direction vector is { sin, cos }. Compared against the unit
// vector from the player to the source. Default half-angle PI/2 => the whole front hemisphere.
function isLookingAt(facing: number, from: Vec2, to: Vec2, halfAngle: number): boolean {
  const d = sub(to, from);
  if (length(d) < 1e-6) return true; // on top of the source: always counts as looking at it
  const face = { x: Math.sin(facing), z: Math.cos(facing) };
  const cosAng = Math.max(-1, Math.min(1, dot(normalize(d), face)));
  return Math.acos(cosAng) <= halfAngle;
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

function findInterceptor(players: Player[], src: Vec2, tgt: Vec2, excludeId: string): Player | null {
  for (const p of players) {
    if (!p.alive || p.id === excludeId) continue;
    if (isOnTetherLine(p.pos, src, tgt)) return p;
  }
  return null;
}

function shapeOrigin(shape: AOEShape): Vec2 {
  return shape.kind === "circle" || shape.kind === "donut" ? shape.center : shape.origin;
}

function didAct(intent: Intent | undefined): boolean {
  return !!intent && (length(intent.move) > 0 || intent.jump === true || intent.sprint === true);
}

function isEffectActiveAt(effect: StatusEffect, time: number): boolean {
  return effect.appliedAt + effect.duration > time;
}

function effectActiveDt(effect: StatusEffect, previousTime: number, time: number): number {
  const activeStart = Math.max(previousTime, effect.appliedAt);
  const activeEnd = Math.min(time, effect.appliedAt + effect.duration);
  return Math.max(0, activeEnd - activeStart);
}

function applyKnockback(player: Player, knockback: Knockback, origin: Vec2): void {
  const away = sub(player.pos, origin);
  const dir = length(away) > 0 ? normalize(away) : { x: 1, z: 0 }; // player on origin: arbitrary dir
  const { distance, height } = knockback;
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

function applyEffect(player: Player, spec: EffectSpec, time: number, id: string, players: Player[], plantSlot?: number): void {
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
    lockedTargetId,
    plantSlot,
  }];
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
function activeEffectOfKind(player: Player, time: number, kind: EffectBehavior["kind"]): StatusEffect | null {
  for (const effect of player.effects) {
    if (isEffectActiveAt(effect, time) && effect.behavior.kind === kind) return effect;
  }
  return null;
}

export function tick(world: World, intents: Intents, dt: number): World {
  const previousTime = world.time;
  const time = world.time + dt;
  const players = world.players.map(p => ({ ...p }));
  const log: LogEntry[] = world.log.slice();
  const actedByPlayer = new Map<string, boolean>();
  const groupChoices = { ...world.groupChoices };
  // Seeded PRNG threaded through the world so each pull is reproducible. Local helpers advance
  // the state in place; the final state is written back into the returned world.
  let rngState = world.rngState;
  const randFloat = () => { const r = nextRandom(rngState); rngState = r.state; return r.value; };
  const randInt = (n: number) => { const r = randomInt(rngState, n); rngState = r.state; return r.value; };
  // tick never mutates the incoming world: clone the boss (threat is the one nested
  // mutable object we write) so the returned snapshot is fresh. See world.ts/net.ts.
  const boss = { ...world.boss, threat: { ...world.boss.threat } };

  // 1. Apply player movement
  for (const player of players) {
    if (!player.alive) continue;
    // Sleep disables all input for its duration; confusion overrides movement (handled below).
    const asleep = activeEffectOfKind(player, time, "sleep") !== null;
    const confusion = asleep ? null : activeEffectOfKind(player, time, "confusion");
    const intent = asleep ? undefined : intents[player.id];
    actedByPlayer.set(player.id, didAct(intent) || confusion !== null);

    if (intent?.jump && player.y === 0) {
      player.verticalVelocity = JUMP_SPEED;
    }

    if (intent?.sprint && player.sprintCooldown <= 0) {
      player.sprintActive = SPRINT_DURATION;
      player.sprintCooldown = SPRINT_COOLDOWN;
    }
    if (player.sprintCooldown > 0) player.sprintCooldown = Math.max(0, player.sprintCooldown - dt);
    if (player.sprintActive > 0) player.sprintActive = Math.max(0, player.sprintActive - dt);

    if (intent?.antiKnockback && player.antiKbCooldown <= 0) {
      player.antiKbActive = ANTI_KB_DURATION;
      player.antiKbCooldown = ANTI_KB_COOLDOWN;
    }

    // Provoke: tank-only threat grab. Sets the tank above the current max so the boss
    // retargets them in this tick's targeting pass (section 1b, below the loop).
    if (intent?.provoke && player.role === "tank" && player.provokeCooldown <= 0) {
      const maxThreat = Math.max(0, ...Object.values(boss.threat));
      boss.threat[player.id] = maxThreat + PROVOKE_LEAD;
      player.provokeCooldown = PROVOKE_COOLDOWN;
    }
    if (player.provokeCooldown > 0) player.provokeCooldown = Math.max(0, player.provokeCooldown - dt);

    if (intent?.toggleInvincibility) {
      player.invincible = !player.invincible;
    }
    if (player.antiKbCooldown > 0) player.antiKbCooldown = Math.max(0, player.antiKbCooldown - dt);
    if (player.antiKbActive > 0) player.antiKbActive = Math.max(0, player.antiKbActive - dt);

    // Forced movement (knockback/knockup) suppresses normal input while it carries the player.
    const beingKnocked = length(player.knockbackVelocity) > 1e-6;
    const speed = player.sprintActive > 0 ? MOVE_SPEED * SPRINT_MULTIPLIER : MOVE_SPEED;
    if (!beingKnocked && confusion) {
      // Confusion: walk toward the locked target. On contact the target takes the hit and it ends.
      const target = players.find(p => p.id === confusion.lockedTargetId && p.alive);
      const cb = confusion.behavior as Extract<EffectBehavior, { kind: "confusion" }>;
      if (target) {
        const toTarget = sub(target.pos, player.pos);
        if (length(toTarget) <= cb.radius) {
          applyMechanicDamage(target, cb.damage, cb.damageType, time);
          player.effects = player.effects.filter(e => e.id !== confusion.id);
          log.push({ t: time, mechanic: confusion.name, playerId: target.id, event: "hit" });
        } else {
          player.pos = add(player.pos, scale(normalize(toTarget), MOVE_SPEED * dt));
          player.facing = Math.atan2(toTarget.x, toTarget.z);
        }
      }
    } else if (!beingKnocked && intent && length(intent.move) > 0) {
      player.pos = add(player.pos, scale(normalize(intent.move), speed * dt));
      player.facing = Math.atan2(intent.move.x, intent.move.z);
    }
    if (beingKnocked) {
      player.pos = add(player.pos, scale(player.knockbackVelocity, dt));
    }

    // Vertical physics: gravity applies while airborne or while over the void (off-floor).
    // Landing only catches a player descending through the floor from above (prevY >= 0),
    // so a player who has already sunk below the floor keeps falling even back over a zone.
    const grounded = isOnFloor(player.pos, world.arena.zones);

    // Ground friction decelerates a horizontal knockback to rest after its target distance.
    // An airborne knockup keeps constant horizontal velocity until it lands.
    if (beingKnocked && grounded && player.y <= 0) {
      const sp = Math.max(0, length(player.knockbackVelocity) - KNOCKBACK_FRICTION * dt);
      player.knockbackVelocity = sp > 0 ? scale(normalize(player.knockbackVelocity), sp) : { x: 0, z: 0 };
    }

    if (!grounded || player.y > 0 || player.verticalVelocity !== 0) {
      const prevY = player.y;
      player.y += player.verticalVelocity * dt;
      player.verticalVelocity -= GRAVITY * dt;
      if (grounded && prevY >= 0 && player.y <= 0) {
        player.y = 0;
        player.verticalVelocity = 0;
        player.knockbackVelocity = { x: 0, z: 0 }; // a knockup lands cleanly at its target distance
      }
    }

    // Falling off the map kills even an invincible player — invincibility only negates damage.
    if (player.y <= DEATH_FLOOR_Y) {
      player.hp = 0;
      player.alive = false;
      player.verticalVelocity = 0;
      log.push({ t: time, mechanic: "arena", playerId: player.id, event: "fell" });
    }
  }

  // 1b. Boss targeting + facing: pick the top-threat alive player and turn to face them.
  // Per-tick snap (no turn-rate clamp); visual smoothing is done client-side in net.ts.
  // A lockFacing cast freezes the boss's facing for its duration so it matches its telegraph.
  boss.currentTarget = topThreatTarget(players, boss.threat);
  const facingLocked = world.active.some(m =>
    m.lockFacing && !m.resolved && m.telegraphStart <= time && m.resolveAt > time);
  if (boss.currentTarget && !facingLocked) {
    const target = players.find(p => p.id === boss.currentTarget)!;
    boss.facing = Math.atan2(target.pos.x - boss.pos.x, target.pos.z - boss.pos.z);
  }

  // 1c. Forced-march traps: arm pending, capture the first entrant, then run the
  // freeze -> teleport -> freeze sequence. Runs after movement so it sees updated positions.
  const FORCED_MARCH_LINGER = 0.4; // keep a finished trap briefly so the client can fade it
  let forcedMarches: ActiveForcedMarch[] = world.forcedMarches.map(fm => ({ ...fm }));
  for (const pfm of world.pendingForcedMarches) {
    if (pfm.t <= time) {
      forcedMarches.push({
        id: pfm.id, name: pfm.name, pos: pfm.pos, radius: pfm.radius,
        direction: pfm.direction, distance: pfm.distance,
        preDelay: pfm.preDelay, postDelay: pfm.postDelay, relativeMove: false,
        armedAt: pfm.t, expireAt: pfm.t + pfm.duration, triggered: false, teleported: false,
      });
    }
  }
  const remainingPendingForcedMarches = world.pendingForcedMarches.filter(pfm => pfm.t > time);
  for (const fm of forcedMarches) {
    if (!fm.triggered && time >= fm.armedAt) {
      // First living player (in roster order) inside the zone is captured and frozen in place.
      const entrant = players.find(p => p.alive && length(sub(p.pos, fm.pos)) <= fm.radius);
      if (entrant) {
        fm.triggered = true;
        fm.triggeredAt = time;
        fm.capturedPlayerId = entrant.id;
        fm.capturedFrom = { x: entrant.pos.x, z: entrant.pos.z };
        // A transient sleep effect holds them still for the windup + recovery window.
        applyEffect(entrant, {
          name: fm.name, kind: "debuff",
          duration: fm.preDelay + fm.postDelay,
          behavior: { kind: "sleep" },
        }, time, `${fm.id}-freeze`, players);
      }
    } else if (!fm.teleported && time >= (fm.triggeredAt ?? time) + fm.preDelay) {
      // windup (preDelay) elapsed: instantly teleport the captured player to the destination.
      const captured = players.find(p => p.id === fm.capturedPlayerId && p.alive);
      if (captured) {
        // forced_march anchors the destination to the trap center; the plant trap teleports the
        // captured player `distance` from their own spot so it lands purely along `direction`.
        const anchor = fm.relativeMove ? (fm.capturedFrom ?? fm.pos) : fm.pos;
        captured.pos = add(anchor, scale(normalize(fm.direction), fm.distance));
        captured.facing = Math.atan2(fm.direction.x, fm.direction.z);
        log.push({ t: time, mechanic: fm.name, playerId: captured.id, event: "hit" });
      }
      fm.teleported = true;
    }
  }
  forcedMarches = forcedMarches.filter(fm =>
    fm.triggered
      ? time <= (fm.triggeredAt ?? time) + fm.preDelay + fm.postDelay + FORCED_MARCH_LINGER
      : fm.expireAt > time);

  // 2. Tether sources: promote, update attachments, finalize
  let tetherSources: TetherSource[] = world.tetherSources.map(ts => ({ ...ts }));
  const remainingPendingTethers = [];
  for (const pt of world.pendingTethers) {
    if (pt.t <= time) {
      const nearest = selectTargetPlayer(players, pt.pos, "closest");
      tetherSources.push({
        id: pt.id,
        pos: pt.pos,
        spawnAt: pt.t,
        finalizeAt: pt.t + pt.finalizeAfter,
        tetherKind: pt.tetherKind,
        buffName: pt.buffName,
        behavior: pt.behavior,
        effectDuration: pt.effectDuration,
        tetheredPlayerId: nearest?.id ?? null,
        finalized: false,
      });
    } else {
      remainingPendingTethers.push(pt);
    }
  }

  for (const ts of tetherSources) {
    if (ts.finalized) continue;

    // Re-attach if current target is dead
    if (ts.tetheredPlayerId) {
      const target = players.find(p => p.id === ts.tetheredPlayerId);
      if (!target?.alive) ts.tetheredPlayerId = selectTargetPlayer(players, ts.pos, "closest")?.id ?? null;
    } else {
      ts.tetheredPlayerId = selectTargetPlayer(players, ts.pos, "closest")?.id ?? null;
    }

    // Check for interceptions (only before finalization)
    if (ts.tetheredPlayerId && time < ts.finalizeAt) {
      const target = players.find(p => p.id === ts.tetheredPlayerId)!;
      const interceptor = findInterceptor(players, ts.pos, target.pos, ts.tetheredPlayerId);
      if (interceptor) ts.tetheredPlayerId = interceptor.id;
    }

    // Finalize
    if (time >= ts.finalizeAt) {
      ts.finalized = true;
      const target = players.find(p => p.id === ts.tetheredPlayerId);
      if (target) {
        applyEffect(target, {
          name: ts.buffName,
          kind: ts.tetherKind,
          duration: ts.effectDuration,
          behavior: ts.behavior,
        }, time, `${ts.id}-effect`, players);
        log.push({ t: time, mechanic: ts.buffName, playerId: target.id, event: ts.tetherKind === "buff" ? "cleared" : "hit" });
      }
    }
  }

  // Cull sources finalized more than 2s ago
  tetherSources = tetherSources.filter(ts => !ts.finalized || ts.finalizeAt > time - 2);

  // 2a. Line links: visual object-to-player links, fixed targets, hidden debuffs until resolve.
  const remainingPendingLineLinks: PendingLineLink[] = [];
  const lineLinks: ActiveLineLink[] = world.lineLinks.map(link => ({ ...link }));
  for (const pendingLink of world.pendingLineLinks) {
    if (pendingLink.t <= time) {
      const targets = selectLineLinkTargets(players, pendingLink.pos, pendingLink.target);
      const resolveAt = pendingLink.t + pendingLink.resolveAfter;
      for (const target of targets) {
        applyEffect(target, {
          name: pendingLink.hiddenDebuffName,
          kind: "debuff",
          duration: Math.max(0.01, resolveAt - time),
          behavior: { kind: "none" },
          visibility: "invisible",
        }, time, `${pendingLink.id}-${target.id}-hidden`, players);
      }
      lineLinks.push({
        id: pendingLink.id,
        name: pendingLink.name,
        pos: pendingLink.pos,
        spawnAt: pendingLink.t,
        linkUntil: pendingLink.t + pendingLink.linkDuration,
        resolveAt,
        target: pendingLink.target,
        targetPlayerIds: targets.map(target => target.id),
        hiddenDebuffName: pendingLink.hiddenDebuffName,
        applyEffect: pendingLink.applyEffect,
        knockback: pendingLink.knockback,
        visual: pendingLink.visual,
        resolved: false,
      });
    } else {
      remainingPendingLineLinks.push(pendingLink);
    }
  }

  const stillLineLinks: ActiveLineLink[] = [];
  for (const link of lineLinks) {
    if (!link.resolved && time >= link.resolveAt) {
      link.resolved = true;
      for (const targetId of link.targetPlayerIds) {
        const target = players.find(p => p.id === targetId);
        if (!target) continue;
        target.effects = target.effects.filter(e => e.id !== `${link.id}-${target.id}-hidden`);
        if (target.alive) {
          if (link.applyEffect) applyEffect(target, link.applyEffect, time, `${link.id}-${target.id}-eff`, players);
          if (link.knockback && target.antiKbActive <= 0) {
            applyKnockback(target, link.knockback, link.knockback.origin ?? link.pos);
          }
          log.push({ t: time, mechanic: link.name, playerId: target.id, event: "hit" });
        }
      }
    }

    if (!link.resolved || link.resolveAt >= time - LINE_LINK_LINGER) {
      stillLineLinks.push(link);
    }
  }

  // 2b. Chains: promote pending pairs, bind the debuff at cast end, break on separation,
  // burst on expiry. The chain entity is authoritative; the debuff is display-only.
  const remainingPendingChains: PendingChain[] = [];
  const chains: ActiveChain[] = world.chains.map(c => ({ ...c }));
  for (const pc of world.pendingChains) {
    if (pc.t <= time) {
      chains.push({
        id: pc.id,
        name: pc.name,
        a: pc.a,
        b: pc.b,
        telegraphStart: pc.t,
        resolveAt: pc.t + pc.telegraph,
        expireAt: pc.t + pc.telegraph + pc.breakWindow,
        breakDistance: pc.breakDistance,
        breakDamage: pc.breakDamage,
        damageType: pc.damageType,
        debuffName: pc.debuffName,
        showCastBar: pc.showCastBar,
        resolved: false,
        broken: false,
      });
    } else {
      remainingPendingChains.push(pc);
    }
  }

  const stillChains: ActiveChain[] = [];
  for (const chain of chains) {
    const a = players.find(p => p.id === chain.a);
    const b = players.find(p => p.id === chain.b);
    const aEffId = `${chain.id}-${chain.a}-eff`;
    const bEffId = `${chain.id}-${chain.b}-eff`;

    // Cast end: bind the debuff to both living members; the line now connects them.
    // The break threshold is the pair's starting separation plus the configured extra distance.
    if (!chain.resolved && time >= chain.resolveAt) {
      chain.resolved = true;
      const startDist = a && b ? length(sub(a.pos, b.pos)) : 0;
      chain.breakAt = startDist + chain.breakDistance;
      const spec: EffectSpec = {
        name: chain.debuffName,
        kind: "debuff",
        duration: chain.expireAt - chain.resolveAt,
        behavior: { kind: "none" },
      };
      if (a?.alive) applyEffect(a, spec, time, aEffId, players);
      if (b?.alive) applyEffect(b, spec, time, bEffId, players);
    }

    if (chain.resolved && chain.outcome === undefined) {
      if (a?.alive && b?.alive && length(sub(a.pos, b.pos)) > (chain.breakAt ?? chain.breakDistance)) {
        // Separated far enough in time: chain breaks, debuff falls off both, no damage.
        chain.broken = true;
        chain.outcome = "broken";
        chain.finishedAt = time;
        a.effects = a.effects.filter(e => e.id !== aEffId);
        b.effects = b.effects.filter(e => e.id !== bEffId);
        log.push({ t: time, mechanic: chain.name, playerId: chain.a, event: "cleared" });
        log.push({ t: time, mechanic: chain.name, playerId: chain.b, event: "cleared" });
      } else if (time >= chain.expireAt) {
        // Still chained when the window closes: both eat a single burst.
        chain.outcome = "damaged";
        chain.finishedAt = time;
        for (const member of [a, b]) {
          if (!member?.alive) continue;
          member.hp = Math.max(0, member.hp - chain.breakDamage);
          if (member.hp <= 0) member.alive = false;
          member.effects = member.effects.filter(e => e.id !== `${chain.id}-${member.id}-eff`);
          log.push({ t: time, mechanic: chain.name, playerId: member.id, event: "hit" });
        }
      }
    }

    // Keep briefly after the outcome so the renderer can flash the result.
    if (chain.outcome === undefined || (chain.finishedAt ?? time) >= time - CHAIN_LINGER) {
      stillChains.push(chain);
    }
  }

  // 3. Promote pending events whose t <= time (boss snapshots facing-anchored shapes)
  const { promoted, remaining: pending } = promotePending(world.pending, time, boss);
  const active: ActiveMechanic[] = [...world.active.map(m => ({ ...m })), ...promoted];

  // 3b. Promote targeted events into casts. The near/far target (and circle center) is
  // chosen when the cast resolves, not now, so players can reposition during the telegraph.
  const remainingPendingTargeted: PendingTargetedEvent[] = [];
  for (const pt of world.pendingTargeted) {
    if (pt.t <= time) {
      active.push({
        id: pt.id,
        name: pt.name,
        shape: { kind: "circle", center: { x: 0, z: 0 }, radius: pt.radius },
        telegraphStart: pt.t,
        resolveAt: pt.t + pt.telegraph,
        damage: pt.damage,
        damageType: pt.damageType,
        applyEffect: pt.applyEffect,
        resolved: false,
        showCastBar: pt.showCastBar,
        showTelegraph: pt.showTelegraph,
        targeting: { mode: pt.targetMode, role: pt.role, origin: { x: 0, z: 0 } },
      });
    } else {
      remainingPendingTargeted.push(pt);
    }
  }

  // 3c. Promote effect-burst events: at cast start, drop an AOE circle on every player carrying the
  // named effect (e.g. a burst around each sleeping player). They then resolve like normal AOEs.
  const remainingPendingEffectBursts: PendingEffectBurst[] = [];
  for (const pb of world.pendingEffectBursts) {
    if (pb.t <= time) {
      const carriers = players.filter(p => p.alive && p.effects.some(e => e.name === pb.effectName && isEffectActiveAt(e, time)));
      carriers.forEach((carrier, i) => {
        active.push({
          id: `${pb.id}-${carrier.id}`,
          name: pb.name,
          shape: { kind: "circle", center: { x: carrier.pos.x, z: carrier.pos.z }, radius: pb.radius },
          telegraphStart: pb.t,
          resolveAt: pb.t + pb.telegraph,
          damage: pb.damage,
          damageType: pb.damageType,
          applyEffect: pb.applyEffect,
          knockback: pb.knockback,
          resolved: false,
          showCastBar: pb.showCastBar && i === 0, // one cast bar for the whole set
          showTelegraph: pb.showTelegraph,
        });
      });
    } else {
      remainingPendingEffectBursts.push(pb);
    }
  }

  // 3. Resolve mechanics past resolveAt (FFXIV snapshot semantics)
  const stillActive: ActiveMechanic[] = [];
  for (const mechanic of active) {
    if (!mechanic.resolved && mechanic.resolveAt <= time) {
      if (mechanic.targeting && mechanic.shape.kind === "circle") {
        const target = mechanic.targeting.mode === "aggro"
          ? players.find(p => p.alive && p.id === boss.currentTarget) ?? null
          : selectTargetPlayer(players, mechanic.targeting.origin, mechanic.targeting.mode, mechanic.targeting.role);
        if (!target) { mechanic.resolved = true; continue; } // no valid target: fizzle, no telegraph flash
        mechanic.shape = { kind: "circle", center: { x: target.pos.x, z: target.pos.z }, radius: mechanic.shape.radius };
      }
      for (const player of players) {
        if (!player.alive) continue;
        const inArc = !mechanic.positional || inPositionalArc(boss, player.pos, mechanic.positional);
        if (pointInShape(mechanic.shape, player.pos) && inArc) {
          applyMechanicDamage(player, mechanic.damage, mechanic.damageType, time);
          log.push({ t: time, mechanic: mechanic.name, playerId: player.id, event: "hit" });
          if (mechanic.applyEffect && player.alive) {
            // For a plant debuff, stamp this player's assigned heading from the combination plan.
            // The slot is how many plants they already carry (0 = first/short, 1 = second/long).
            let spec = mechanic.applyEffect;
            let plantSlot: number | undefined;
            if (spec.behavior.kind === "plant") {
              plantSlot = player.effects.filter(e => e.behavior.kind === "plant").length;
              const dir = world.plantPlan[player.id]?.[plantSlot];
              if (dir) spec = { ...spec, behavior: { ...spec.behavior, direction: dir } };
            }
            applyEffect(player, spec, time, `${mechanic.id}-${player.id}-eff`, players, plantSlot);
          }
          if (mechanic.knockback && player.alive && player.antiKbActive <= 0) {
            const origin = mechanic.knockback.origin ?? shapeOrigin(mechanic.shape);
            applyKnockback(player, mechanic.knockback, origin);
          }
        } else {
          log.push({ t: time, mechanic: mechanic.name, playerId: player.id, event: "cleared" });
        }
      }
      mechanic.resolved = true;
    }
    // Keep briefly after resolve so the renderer can flash the hit; targeted baits linger
    // longer so the circle stays visible where it landed (damage already applied at resolveAt).
    const keepFor = mechanic.targeting ? TARGETED_LINGER : dt;
    if (!mechanic.resolved || mechanic.resolveAt >= time - keepFor) {
      stillActive.push(mechanic);
    }
  }

  // 3c. Towers: promote pending, track live soakers each tick, resolve at telegraph end.
  const remainingPendingTowers: PendingTower[] = [];
  const towers: ActiveTower[] = world.towers.map(t => ({ ...t }));
  for (const pt of world.pendingTowers) {
    if (pt.t <= time) {
      towers.push({
        id: pt.id,
        name: pt.name,
        pos: pt.pos,
        radius: pt.radius,
        telegraphStart: pt.t,
        resolveAt: pt.t + pt.telegraph,
        requiredCount: pt.requiredCount,
        requiredRoles: pt.requiredRoles,
        wrongRoleLethal: pt.wrongRoleLethal,
        failureDamage: pt.failureDamage,
        failureDamageType: pt.failureDamageType,
        applyEffect: pt.applyEffect,
        knockback: pt.knockback,
        visual: pt.visual,
        resolved: false,
        soakerCount: 0,
      });
    } else {
      remainingPendingTowers.push(pt);
    }
  }

  const stillTowers: ActiveTower[] = [];
  for (const tower of towers) {
    if (!tower.resolved) {
      const towerShape: AOEShape = { kind: "circle", center: tower.pos, radius: tower.radius };
      const inside = players.filter(p => p.alive && pointInShape(towerShape, p.pos));
      const validSoakers = inside.filter(p => !tower.requiredRoles || tower.requiredRoles.includes(p.role));
      tower.soakerCount = validSoakers.length;

      if (tower.resolveAt <= time) {
        // Wrong-role soakers die when the tower opts into lethal punishment.
        if (tower.requiredRoles && tower.wrongRoleLethal) {
          for (const p of inside) {
            if (!tower.requiredRoles.includes(p.role) && !p.invincible) {
              p.hp = 0;
              p.alive = false;
              log.push({ t: time, mechanic: tower.name, playerId: p.id, event: "hit" });
            }
          }
        }
        const success = validSoakers.length >= tower.requiredCount;
        if (success) {
          for (const p of validSoakers) {
            if (!p.alive) continue;
            if (tower.applyEffect) applyEffect(p, tower.applyEffect, time, `${tower.id}-${p.id}-eff`, players);
            if (tower.knockback && p.antiKbActive <= 0) {
              applyKnockback(p, tower.knockback, tower.knockback.origin ?? tower.pos);
            }
            log.push({ t: time, mechanic: tower.name, playerId: p.id, event: "cleared" });
          }
        } else {
          // Unsoaked: the whole raid eats the failure damage.
          for (const p of players) {
            if (!p.alive || p.invincible) continue;
            p.hp = Math.max(0, p.hp - tower.failureDamage);
            if (p.hp <= 0) p.alive = false;
            log.push({ t: time, mechanic: tower.name, playerId: p.id, event: "hit" });
          }
        }
        tower.resolved = true;
        tower.outcome = success ? "success" : "failure";
      }
    }
    // Keep briefly after resolve so the renderer can flash success/failure.
    if (!tower.resolved || tower.resolveAt >= time - TOWER_LINGER) {
      stillTowers.push(tower);
    }
  }

  // 3d. Group events: at cast start pick a group (random / complement of a linked event) and a
  // random member to mark; at resolve split the unavoidable damage across the chosen group.
  const remainingPendingGroups: PendingGroupEvent[] = [];
  const groupMechanics: ActiveGroupMechanic[] = world.groupMechanics.map(g => ({ ...g }));
  for (const pg of world.pendingGroups) {
    if (pg.t <= time) {
      let chosenIdx: number;
      const linkedIdx = pg.link !== undefined ? groupChoices[pg.link] : undefined;
      if (linkedIdx !== undefined) {
        chosenIdx = 1 - linkedIdx; // 2-group complement (validated by the schema)
      } else if (pg.rng) {
        chosenIdx = randInt(pg.groups.length);
      } else {
        chosenIdx = 0;
      }
      groupChoices[pg.id] = chosenIdx;

      const members = pg.groups[chosenIdx];
      const marked = members[randInt(members.length)];

      groupMechanics.push({
        id: pg.id,
        name: pg.name,
        telegraphStart: pg.t,
        resolveAt: pg.t + pg.telegraph,
        markedPlayerId: marked,
        radius: pg.radius,
        requiredCount: pg.requiredCount,
        damage: pg.damage,
        damageType: pg.damageType,
        applyEffect: pg.applyEffect,
        resolved: false,
        showCastBar: pg.showCastBar,
      });
    } else {
      remainingPendingGroups.push(pg);
    }
  }

  const stillGroups: ActiveGroupMechanic[] = [];
  for (const gm of groupMechanics) {
    if (!gm.resolved && gm.resolveAt <= time) {
      // Shared stack: a circle around the marked player. Soakers inside split the damage; if
      // fewer than requiredCount stack, it fails and each soaker eats the full (unsplit) hit.
      const marked = players.find(p => p.id === gm.markedPlayerId);
      if (marked?.alive) {
        const circle: AOEShape = { kind: "circle", center: marked.pos, radius: gm.radius };
        const soakers = players.filter(p => p.alive && pointInShape(circle, p.pos));
        const success = soakers.length >= gm.requiredCount;
        const per = success ? gm.damage / soakers.length : gm.damage;
        for (const player of soakers) {
          applyMechanicDamage(player, per, gm.damageType, time);
          log.push({ t: time, mechanic: gm.name, playerId: player.id, event: "hit" });
          if (gm.applyEffect && player.alive) {
            applyEffect(player, gm.applyEffect, time, `${gm.id}-${player.id}-eff`, players);
          }
        }
        gm.outcome = success ? "success" : "failure";
      }
      gm.resolved = true;
    }
    // Keep briefly after resolve so the renderer can flash the hit.
    if (!gm.resolved || gm.resolveAt >= time - TARGETED_LINGER) {
      stillGroups.push(gm);
    }
  }

  // 3e. Inverse ("?") events: at cast start roll the inversion. The shown shape is always
  // drawn (telegraph), but when inverted the "?" makes it a lie -> the hidden shape is lethal.
  const remainingPendingInversions: PendingInverse[] = [];
  const inversions: ActiveInverse[] = world.inversions.map(i => ({ ...i }));
  for (const pi of world.pendingInversions) {
    if (pi.t <= time) {
      const inverted = pi.questionMark ?? (pi.rng ? randFloat() < 0.5 : false);
      inversions.push({
        id: pi.id,
        name: pi.name,
        shownShapes: pi.shownShapes,
        hiddenShapes: pi.hiddenShapes,
        ringColor: pi.ringColor,
        ringHeight: pi.ringHeight,
        inverted,
        telegraphStart: pi.t,
        resolveAt: pi.t + pi.telegraph,
        damage: pi.damage,
        damageType: pi.damageType,
        applyEffect: pi.applyEffect,
        knockback: pi.knockback,
        showCastBar: pi.showCastBar,
        resolved: false,
      });
    } else {
      remainingPendingInversions.push(pi);
    }
  }

  const stillInversions: ActiveInverse[] = [];
  for (const inv of inversions) {
    if (!inv.resolved && inv.resolveAt <= time) {
      const lethal = inv.inverted ? inv.hiddenShapes : inv.shownShapes;
      for (const player of players) {
        if (!player.alive) continue;
        const hitShape = lethal.find(shape => pointInShape(shape, player.pos));
        if (hitShape) {
          applyMechanicDamage(player, inv.damage, inv.damageType, time);
          log.push({ t: time, mechanic: inv.name, playerId: player.id, event: "hit" });
          if (inv.applyEffect && player.alive) {
            applyEffect(player, inv.applyEffect, time, `${inv.id}-${player.id}-eff`, players);
          }
          if (inv.knockback && player.alive && player.antiKbActive <= 0) {
            applyKnockback(player, inv.knockback, inv.knockback.origin ?? shapeOrigin(hitShape));
          }
        } else {
          log.push({ t: time, mechanic: inv.name, playerId: player.id, event: "cleared" });
        }
      }
      inv.resolved = true;
    }
    // Keep briefly after resolve so the renderer can flash the hit.
    if (!inv.resolved || inv.resolveAt >= time - dt) {
      stillInversions.push(inv);
    }
  }

  // 3f. Gaze events: at cast start roll the reverse state (eye vs "?" eye). At resolve a player
  // is hit if they are facing the eye (normal) or NOT facing it (reverse "?"). Facing is the
  // player's last movement direction, so "looking away" means flicking the stick away then stopping.
  const remainingPendingGazes: PendingGaze[] = [];
  const gazes: ActiveGaze[] = world.gazes.map(g => ({ ...g }));
  for (const pg of world.pendingGazes) {
    if (pg.t <= time) {
      const reverse = pg.rng ? randFloat() < 0.5 : pg.reverse;
      gazes.push({
        id: pg.id,
        name: pg.name,
        pos: pg.pos,
        reverse,
        coneHalfAngle: pg.coneHalfAngle,
        telegraphStart: pg.t,
        resolveAt: pg.t + pg.telegraph,
        damage: pg.damage,
        damageType: pg.damageType,
        applyEffect: pg.applyEffect,
        knockback: pg.knockback,
        showCastBar: pg.showCastBar,
        visual: pg.visual,
        resolved: false,
      });
    } else {
      remainingPendingGazes.push(pg);
    }
  }

  const stillGazes: ActiveGaze[] = [];
  for (const gz of gazes) {
    if (!gz.resolved && gz.resolveAt <= time) {
      for (const player of players) {
        if (!player.alive) continue;
        const looking = isLookingAt(player.facing, player.pos, gz.pos, gz.coneHalfAngle);
        const hit = gz.reverse ? !looking : looking;
        if (hit) {
          applyMechanicDamage(player, gz.damage, gz.damageType, time);
          log.push({ t: time, mechanic: gz.name, playerId: player.id, event: "hit" });
          if (gz.applyEffect && player.alive) {
            applyEffect(player, gz.applyEffect, time, `${gz.id}-${player.id}-eff`, players);
          }
          if (gz.knockback && player.alive && player.antiKbActive <= 0) {
            applyKnockback(player, gz.knockback, gz.knockback.origin ?? gz.pos);
          }
        } else {
          log.push({ t: time, mechanic: gz.name, playerId: player.id, event: "cleared" });
        }
      }
      gz.resolved = true;
    }
    // Keep briefly after resolve so the renderer can flash the hit.
    if (!gz.resolved || gz.resolveAt >= time - dt) {
      stillGazes.push(gz);
    }
  }

  // 4. Apply continuous status effects and expire old effects
  for (const player of players) {
    if (player.alive && !player.invincible) {
      const acted = actedByPlayer.get(player.id) ?? false;
      for (const effect of player.effects) {
        const activeDt = effectActiveDt(effect, previousTime, time);
        if (activeDt <= 0) continue;
        if (
          (effect.behavior.kind === "pyretic" && acted)
          || (effect.behavior.kind === "freeze" && !acted)
        ) {
          player.hp = Math.max(0, player.hp - effect.behavior.dps * activeDt);
          if (player.hp <= 0) {
            player.alive = false;
            log.push({ t: time, mechanic: effect.name, playerId: player.id, event: "hit" });
            break;
          }
        }
      }
    }
    // Plant (Tele-Trouncing): when its debuff expires, place a teleport trap (forced march) at the
    // player's spot. It stays inert for `armDelay` (so the placer can step off) before triggering.
    if (player.alive) {
      for (const effect of player.effects) {
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

  // 5. Derive status
  const anyAlive = players.some(p => p.alive);
  const allResolved = pending.length === 0 && stillActive.every(m => m.resolved)
    && remainingPendingTethers.length === 0 && tetherSources.every(ts => ts.finalized)
    && remainingPendingLineLinks.length === 0 && stillLineLinks.every(link => link.resolved)
    && remainingPendingTargeted.length === 0
    && remainingPendingTowers.length === 0 && stillTowers.every(t => t.resolved)
    && remainingPendingChains.length === 0 && stillChains.every(c => c.outcome !== undefined)
    && remainingPendingGroups.length === 0 && stillGroups.every(g => g.resolved)
    && remainingPendingInversions.length === 0 && stillInversions.every(i => i.resolved)
    && remainingPendingGazes.length === 0 && stillGazes.every(g => g.resolved)
    && remainingPendingForcedMarches.length === 0 && forcedMarches.every(fm => fm.triggered)
    && remainingPendingEffectBursts.length === 0;
  let status = world.status;
  if (status === "running") {
    if (!anyAlive) {
      status = "wiped";
    } else if (world.hasMechanics && allResolved && time >= world.duration) {
      status = "cleared";
    }
  }

  return { ...world, time, rngState, groupChoices, players, boss, active: stillActive, pending, log, status, tetherSources, pendingTethers: remainingPendingTethers, lineLinks: stillLineLinks, pendingLineLinks: remainingPendingLineLinks, pendingTargeted: remainingPendingTargeted, towers: stillTowers, pendingTowers: remainingPendingTowers, chains: stillChains, pendingChains: remainingPendingChains, groupMechanics: stillGroups, pendingGroups: remainingPendingGroups, inversions: stillInversions, pendingInversions: remainingPendingInversions, gazes: stillGazes, pendingGazes: remainingPendingGazes, forcedMarches, pendingForcedMarches: remainingPendingForcedMarches, pendingEffectBursts: remainingPendingEffectBursts };
}
