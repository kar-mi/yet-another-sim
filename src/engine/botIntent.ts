import type { Vec2 } from "@shared/math";
import type { EffectBehavior, Intents, Player, Waypoint, World } from "@shared/types";
import { length, normalize, sub } from "@shared/math";
import { atan2 } from "@shared/dmath";
import { MOVE_SPEED } from "@shared/constants";
import { genericSolverWaypoint, resolvedMechanics } from "./genericSolver";
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
  const mechanics = world.botSolvers?.generic?.length ? resolvedMechanics(world) : undefined;

  for (const player of world.players) {
    if (!player.alive || player.control !== "bot") continue;

    let intent: { move: Vec2; facing?: number } | undefined;

    // A solver hold freezes bots in place until botHoldUntil (set when a matching mechanic resolved).
    if (held) {
      intent = { move: { x: 0, z: 0 } };
    } else {
      const solverTarget = genericSolverWaypoint(player, world, mechanics);
      if (solverTarget) {
        player.botWaypointResumeAfter = world.time;
        intent = moveIntent(player, solverTarget, dt);
      } else if (player.pattern?.length) {
        const waypoint = activeWaypoint(player.pattern, world.time, player.botWaypointResumeAfter);
        if (waypoint) intent = moveIntent(player, waypoint.pos, dt);
      }
    }

    const dirKb = player.effects.find(
      e => e.behavior.kind === "directionalKnockback" && isEffectActiveAt(e, world.time)
    );
    if (dirKb) {
      const b = dirKb.behavior as Extract<EffectBehavior, { kind: "directionalKnockback" }>;
      const kbMechanic = world.active.find(m => m.knockback);
      if (kbMechanic) {
        const kbOrigin = kbMechanic.knockback!.origin ?? shapeOrigin(kbMechanic.shape);
        const awayVec = sub(player.pos, kbOrigin);
        const awayDir = length(awayVec) > 0 ? normalize(awayVec) : { x: 0, z: 1 };
        const faceDir = b.requiredFacing === "away" ? awayDir : { x: -awayDir.x, z: -awayDir.z };
        const facing = atan2(faceDir.x, faceDir.z);
        if (intent) {
          intent.facing = facing;
        } else {
          intent = { move: { x: 0, z: 0 }, facing };
        }
      }
    }

    if (intent) intents[player.id] = intent;
  }

  return intents;
}
