import type { World, Intents, LogEntry, ActiveMechanic } from "../shared/types";
import { add, scale, normalize, length } from "../shared/math";
import { pointInShape, isOnFloor } from "./shapes";
import { promotePending } from "./timeline";

export const MOVE_SPEED = 8;

export function tick(world: World, intents: Intents, dt: number): World {
  const time = world.time + dt;
  const players = world.players.map(p => ({ ...p }));
  const log: LogEntry[] = world.log.slice();

  // 1. Apply movement
  for (const player of players) {
    if (!player.alive) continue;
    const intent = intents[player.id];
    if (!intent || length(intent.move) === 0) continue;
    const newPos = add(player.pos, scale(normalize(intent.move), MOVE_SPEED * dt));
    if (isOnFloor(newPos, world.arena.zones)) {
      player.pos = newPos;
    } else {
      player.hp = 0;
      player.alive = false;
      log.push({ t: time, mechanic: "arena", playerId: player.id, event: "fell" });
    }
  }

  // 2. Promote pending events whose t <= time
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
  const allResolved = pending.length === 0 && stillActive.every(m => m.resolved);
  let status = world.status;
  if (status === "running") {
    if (!anyAlive) {
      status = "wiped";
    } else if (allResolved && time >= world.duration) {
      status = "cleared";
    }
  }

  return { ...world, time, players, active: stillActive, pending, log, status };
}
