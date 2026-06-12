import type { Vec2 } from "../shared/math";
import type { Intents, Player, Waypoint, World } from "../shared/types";
import { length, normalize, sub } from "../shared/math";
import { MOVE_SPEED } from "./sim";
import { forsakenSolverWaypoint } from "./forsakenSolver";
import { genericSolverWaypoint } from "./genericSolver";

function activeWaypoint(pattern: Waypoint[], time: number, after = -Infinity): Waypoint | undefined {
  let active: Waypoint | undefined;
  for (const waypoint of pattern) {
    if (waypoint.t > after && waypoint.t <= time && (!active || waypoint.t >= active.t)) {
      active = waypoint;
    }
  }
  return active;
}

function solverWaypoint(player: Player, world: World): Vec2 | undefined {
  // Generic, data-driven rules are checked first so they can override the forsaken solver below.
  const generic = genericSolverWaypoint(player, world);
  if (generic) return generic;

  return forsakenSolverWaypoint(player, world);
}

function moveIntent(player: Player, target: Vec2, dt: number) {
  const delta = sub(target, player.pos);
  if (length(delta) > MOVE_SPEED * dt) {
    return { move: normalize(delta) };
  }
  return { move: { x: 0, z: 0 } };
}

export function computeBotIntents(world: World, dt: number): Intents {
  const intents: Intents = {};

  for (const player of world.players) {
    if (!player.alive || player.control !== "bot") continue;

    const solverTarget = solverWaypoint(player, world);
    if (solverTarget) {
      intents[player.id] = moveIntent(player, solverTarget, dt);
      continue;
    }

    if (!player.pattern?.length) continue;

    const waypoint = activeWaypoint(player.pattern, world.time, player.botWaypointResumeAfter);
    if (!waypoint) continue;

    intents[player.id] = moveIntent(player, waypoint.pos, dt);
  }

  return intents;
}
