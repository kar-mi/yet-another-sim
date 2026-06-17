import type { Vec2 } from "@shared/math";
import type { EffectBehavior, Intents, Player, Waypoint, World } from "@shared/types";
import { length, normalize, sub } from "@shared/math";
import { atan2 } from "@shared/dmath";
import { MOVE_SPEED } from "@shared/constants";
import { genericSolverWaypoint } from "./genericSolver";
import { isEffectActiveAt, shapeOrigin } from "./systems/helpers";

function activeWaypoint(pattern: Waypoint[], time: number, after = -Infinity): Waypoint | undefined {
  let active: Waypoint | undefined;
  for (const waypoint of pattern) {
    if (waypoint.t > after && waypoint.t <= time && (!active || waypoint.t >= active.t)) {
      active = waypoint;
    }
  }
  return active;
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

  const held = world.botHoldUntil !== undefined && world.time < world.botHoldUntil;

  for (const player of world.players) {
    if (!player.alive || player.control !== "bot") continue;

    // A solver hold freezes bots in place until botHoldUntil (set when a matching mechanic resolved).
    if (held) {
      intents[player.id] = { move: { x: 0, z: 0 } };
      continue;
    }

    const solverTarget = genericSolverWaypoint(player, world);
    if (solverTarget) {
      intents[player.id] = moveIntent(player, solverTarget, dt);
      continue;
    }

    if (!player.pattern?.length) continue;

    const waypoint = activeWaypoint(player.pattern, world.time, player.botWaypointResumeAfter);
    if (!waypoint) continue;

    intents[player.id] = moveIntent(player, waypoint.pos, dt);
  }

  for (const player of world.players) {
    if (!player.alive || player.control !== "bot") continue;
    const dirKb = player.effects.find(
      e => e.behavior.kind === "directionalKnockback" && isEffectActiveAt(e, world.time)
    );
    if (!dirKb) continue;
    const b = dirKb.behavior as Extract<EffectBehavior, { kind: "directionalKnockback" }>;
    const kbMechanic = world.active.find(m => m.knockback);
    if (!kbMechanic) continue;
    const kbOrigin = kbMechanic.knockback!.origin ?? shapeOrigin(kbMechanic.shape);
    const awayVec = sub(player.pos, kbOrigin);
    const awayDir = length(awayVec) > 0 ? normalize(awayVec) : { x: 0, z: 1 };
    const faceDir = b.requiredFacing === "away" ? awayDir : { x: -awayDir.x, z: -awayDir.z };
    const facing = atan2(faceDir.x, faceDir.z);
    const intent = intents[player.id];
    if (intent) {
      intent.facing = facing;
    } else {
      intents[player.id] = { move: { x: 0, z: 0 }, facing };
    }
  }

  return intents;
}
