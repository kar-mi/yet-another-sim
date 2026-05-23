import type { Intents, Waypoint, World } from "../shared/types";
import { length, normalize, sub } from "../shared/math";
import { MOVE_SPEED } from "./sim";

function activeWaypoint(pattern: Waypoint[], time: number): Waypoint | undefined {
  let active: Waypoint | undefined;
  for (const waypoint of pattern) {
    if (waypoint.t <= time && (!active || waypoint.t >= active.t)) {
      active = waypoint;
    }
  }
  return active;
}

export function computeBotIntents(world: World, dt: number): Intents {
  const intents: Intents = {};

  for (const player of world.players) {
    if (!player.alive || player.control !== "bot" || !player.pattern?.length) continue;

    const waypoint = activeWaypoint(player.pattern, world.time);
    if (!waypoint) continue;

    const delta = sub(waypoint.pos, player.pos);
    if (length(delta) > MOVE_SPEED * dt) {
      intents[player.id] = { move: normalize(delta) };
    } else {
      intents[player.id] = { move: { x: 0, z: 0 } };
    }
  }

  return intents;
}
