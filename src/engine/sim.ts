import type { World, Intents, LogEntry, ActiveMechanic, TetherSource, Player } from "../shared/types";
import type { Vec2 } from "../shared/math";
import { add, scale, normalize, length } from "../shared/math";
import { pointInShape, isOnFloor } from "./shapes";
import { promotePending } from "./timeline";

export const MOVE_SPEED = 8;
export const JUMP_SPEED = 9;
export const GRAVITY = 24;
export const SPRINT_DURATION = 5;
export const SPRINT_COOLDOWN = 10;

const INTERCEPT_THRESHOLD = 2.0;

function nearestAlivePlayer(players: Player[], pos: Vec2): Player | null {
  let nearest: Player | null = null;
  let minDist = Infinity;
  for (const p of players) {
    if (!p.alive) continue;
    const dx = p.pos.x - pos.x, dz = p.pos.z - pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < minDist) { minDist = d; nearest = p; }
  }
  return nearest;
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

export function tick(world: World, intents: Intents, dt: number): World {
  const time = world.time + dt;
  const players = world.players.map(p => ({ ...p }));
  const log: LogEntry[] = world.log.slice();

  // 1. Apply player movement
  for (const player of players) {
    if (!player.alive) continue;
    const intent = intents[player.id];

    if (intent?.jump && player.y === 0) {
      player.verticalVelocity = JUMP_SPEED;
    }

    if (intent?.sprint && player.sprintCooldown <= 0) {
      player.sprintActive = SPRINT_DURATION;
      player.sprintCooldown = SPRINT_COOLDOWN;
    }
    if (player.sprintCooldown > 0) player.sprintCooldown = Math.max(0, player.sprintCooldown - dt);
    if (player.sprintActive > 0) player.sprintActive = Math.max(0, player.sprintActive - dt);

    if (player.y > 0 || player.verticalVelocity > 0) {
      player.y += player.verticalVelocity * dt;
      player.verticalVelocity -= GRAVITY * dt;
      if (player.y <= 0) {
        player.y = 0;
        player.verticalVelocity = 0;
      }
    }

    const speed = player.sprintActive > 0 ? MOVE_SPEED * 1.5 : MOVE_SPEED;
    if (intent && length(intent.move) > 0) {
      const newPos = add(player.pos, scale(normalize(intent.move), speed * dt));
      if (isOnFloor(newPos, world.arena.zones)) {
        player.pos = newPos;
      } else {
        player.hp = 0;
        player.alive = false;
        player.y = 0;
        player.verticalVelocity = 0;
        log.push({ t: time, mechanic: "arena", playerId: player.id, event: "fell" });
      }
    }
  }

  // 2. Tether sources: promote, update attachments, finalize
  let tetherSources: TetherSource[] = world.tetherSources.map(ts => ({ ...ts }));
  const remainingPendingTethers = [];
  for (const pt of world.pendingTethers) {
    if (pt.t <= time) {
      const nearest = nearestAlivePlayer(players, pt.pos);
      tetherSources.push({
        id: pt.id,
        pos: pt.pos,
        spawnAt: pt.t,
        finalizeAt: pt.t + pt.finalizeAfter,
        tetherKind: pt.tetherKind,
        buffName: pt.buffName,
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
      if (!target?.alive) ts.tetheredPlayerId = nearestAlivePlayer(players, ts.pos)?.id ?? null;
    } else {
      ts.tetheredPlayerId = nearestAlivePlayer(players, ts.pos)?.id ?? null;
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
        target.effects = [...target.effects, {
          id: `${ts.id}-effect`,
          name: ts.buffName,
          kind: ts.tetherKind,
          appliedAt: time,
          duration: 15,
        }];
        log.push({ t: time, mechanic: ts.buffName, playerId: target.id, event: ts.tetherKind === "buff" ? "cleared" : "hit" });
      }
    }
  }

  // Cull sources finalized more than 2s ago
  tetherSources = tetherSources.filter(ts => !ts.finalized || ts.finalizeAt > time - 2);

  // 3. Promote pending events whose t <= time
  const { promoted, remaining: pending } = promotePending(world.pending, time);
  const active: ActiveMechanic[] = [...world.active.map(m => ({ ...m })), ...promoted];

  // 3. Resolve mechanics past resolveAt (FFXIV snapshot semantics)
  const stillActive: ActiveMechanic[] = [];
  for (const mechanic of active) {
    if (!mechanic.resolved && mechanic.resolveAt <= time) {
      for (const player of players) {
        if (!player.alive) continue;
        if (pointInShape(mechanic.shape, player.pos)) {
          player.hp = Math.max(0, player.hp - mechanic.damage);
          if (player.hp <= 0) player.alive = false;
          log.push({ t: time, mechanic: mechanic.name, playerId: player.id, event: "hit" });
        } else {
          log.push({ t: time, mechanic: mechanic.name, playerId: player.id, event: "cleared" });
        }
      }
      mechanic.resolved = true;
    }
    // Keep for one tick after resolve so renderer can show a flash, then drop
    if (!mechanic.resolved || mechanic.resolveAt >= time - dt) {
      stillActive.push(mechanic);
    }
  }

  // 4. Derive status
  const anyAlive = players.some(p => p.alive);
  const allResolved = pending.length === 0 && stillActive.every(m => m.resolved)
    && remainingPendingTethers.length === 0 && tetherSources.every(ts => ts.finalized);
  let status = world.status;
  if (status === "running") {
    if (!anyAlive) {
      status = "wiped";
    } else if (allResolved && time >= world.duration) {
      status = "cleared";
    }
  }

  return { ...world, time, players, active: stillActive, pending, log, status, tetherSources, pendingTethers: remainingPendingTethers };
}
