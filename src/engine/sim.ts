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
} from "../shared/types";
import type { Vec2 } from "../shared/math";
import { add, scale, normalize, length } from "../shared/math";
import { pointInShape, isOnFloor } from "./shapes";
import { promotePending } from "./timeline";

export const MOVE_SPEED = 8;
export const JUMP_SPEED = 9;
export const GRAVITY = 24;
export const DEATH_FLOOR_Y = -10; // players die after falling this far below the arena floor
export const SPRINT_DURATION = 5;
export const SPRINT_COOLDOWN = 10;

const INTERCEPT_THRESHOLD = 2.0;
const TARGETED_LINGER = 0.7; // seconds a targeted bait's circle stays visible after it resolves

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

function applyEffect(player: Player, spec: EffectSpec, time: number, id: string): void {
  player.effects = [...player.effects, {
    id,
    name: spec.name,
    kind: spec.kind,
    appliedAt: time,
    duration: spec.duration,
    behavior: spec.behavior,
  }];
}

export function tick(world: World, intents: Intents, dt: number): World {
  const previousTime = world.time;
  const time = world.time + dt;
  const players = world.players.map(p => ({ ...p }));
  const log: LogEntry[] = world.log.slice();
  const actedByPlayer = new Map<string, boolean>();

  // 1. Apply player movement
  for (const player of players) {
    if (!player.alive) continue;
    const intent = intents[player.id];
    actedByPlayer.set(player.id, didAct(intent));

    if (intent?.jump && player.y === 0) {
      player.verticalVelocity = JUMP_SPEED;
    }

    if (intent?.sprint && player.sprintCooldown <= 0) {
      player.sprintActive = SPRINT_DURATION;
      player.sprintCooldown = SPRINT_COOLDOWN;
    }
    if (player.sprintCooldown > 0) player.sprintCooldown = Math.max(0, player.sprintCooldown - dt);
    if (player.sprintActive > 0) player.sprintActive = Math.max(0, player.sprintActive - dt);

    const speed = player.sprintActive > 0 ? MOVE_SPEED * 1.5 : MOVE_SPEED;
    if (intent && length(intent.move) > 0) {
      player.pos = add(player.pos, scale(normalize(intent.move), speed * dt));
    }

    // Vertical physics: gravity applies while airborne or while over the void (off-floor).
    // Landing only catches a player descending through the floor from above (prevY >= 0),
    // so a player who has already sunk below the floor keeps falling even back over a zone.
    const grounded = isOnFloor(player.pos, world.arena.zones);
    if (!grounded || player.y > 0 || player.verticalVelocity !== 0) {
      const prevY = player.y;
      player.y += player.verticalVelocity * dt;
      player.verticalVelocity -= GRAVITY * dt;
      if (grounded && prevY >= 0 && player.y <= 0) {
        player.y = 0;
        player.verticalVelocity = 0;
      }
    }

    if (player.y <= DEATH_FLOOR_Y) {
      player.hp = 0;
      player.alive = false;
      player.verticalVelocity = 0;
      log.push({ t: time, mechanic: "arena", playerId: player.id, event: "fell" });
    }
  }

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
        }, time, `${ts.id}-effect`);
        log.push({ t: time, mechanic: ts.buffName, playerId: target.id, event: ts.tetherKind === "buff" ? "cleared" : "hit" });
      }
    }
  }

  // Cull sources finalized more than 2s ago
  tetherSources = tetherSources.filter(ts => !ts.finalized || ts.finalizeAt > time - 2);

  // 3. Promote pending events whose t <= time
  const { promoted, remaining: pending } = promotePending(world.pending, time);
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
        targeting: { mode: pt.targetMode, role: pt.role, origin: { x: 0, z: 0 } },
      });
    } else {
      remainingPendingTargeted.push(pt);
    }
  }

  // 3. Resolve mechanics past resolveAt (FFXIV snapshot semantics)
  const stillActive: ActiveMechanic[] = [];
  for (const mechanic of active) {
    if (!mechanic.resolved && mechanic.resolveAt <= time) {
      if (mechanic.targeting && mechanic.shape.kind === "circle") {
        const target = selectTargetPlayer(players, mechanic.targeting.origin, mechanic.targeting.mode, mechanic.targeting.role);
        if (!target) { mechanic.resolved = true; continue; } // no valid target: fizzle, no telegraph flash
        mechanic.shape = { kind: "circle", center: { x: target.pos.x, z: target.pos.z }, radius: mechanic.shape.radius };
      }
      for (const player of players) {
        if (!player.alive) continue;
        if (pointInShape(mechanic.shape, player.pos)) {
          const matchingVulnIds = new Set<string>();
          let damage = mechanic.damage;
          for (const effect of player.effects) {
            if (!isEffectActiveAt(effect, time)) continue;
            if (effect.behavior.kind === "vuln" && effect.behavior.damageType === mechanic.damageType) {
              damage *= effect.behavior.multiplier;
              matchingVulnIds.add(effect.id);
            }
          }
          if (matchingVulnIds.size > 0 && mechanic.damage > 0) {
            player.effects = player.effects.filter(effect => !matchingVulnIds.has(effect.id));
          }
          player.hp = Math.max(0, player.hp - damage);
          if (player.hp <= 0) player.alive = false;
          log.push({ t: time, mechanic: mechanic.name, playerId: player.id, event: "hit" });
          if (mechanic.applyEffect && player.alive) {
            applyEffect(player, mechanic.applyEffect, time, `${mechanic.id}-${player.id}-eff`);
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

  // 4. Apply continuous status effects and expire old effects
  for (const player of players) {
    if (player.alive) {
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
    player.effects = player.effects.filter(effect => isEffectActiveAt(effect, time));
  }

  // 5. Derive status
  const anyAlive = players.some(p => p.alive);
  const allResolved = pending.length === 0 && stillActive.every(m => m.resolved)
    && remainingPendingTethers.length === 0 && tetherSources.every(ts => ts.finalized)
    && remainingPendingTargeted.length === 0;
  let status = world.status;
  if (status === "running") {
    if (!anyAlive) {
      status = "wiped";
    } else if (world.hasMechanics && allResolved && time >= world.duration) {
      status = "cleared";
    }
  }

  return { ...world, time, players, active: stillActive, pending, log, status, tetherSources, pendingTethers: remainingPendingTethers, pendingTargeted: remainingPendingTargeted };
}
