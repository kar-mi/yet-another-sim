// Phase 3f: spread/stack "?" events. At cast start roll the flip and pick the stack-mode marked
// member(s). The shown marker lies when inverted -> the actual mode is the opposite. At resolve,
// spread drops a personal AOE on every player (overlap = extra hits); stack soaks on the marked.

import type { TickContext } from "./context";
import type { ActiveSpreadStack, PendingSpreadStack, AOEShape } from "../../shared/types";
import { pointInShape } from "../shapes";
import { applyMechanicDamage } from "./helpers";
import { cullResolved } from "./util";
import { TARGETED_LINGER } from "../constants";

export function resolveSpreadStacks(ctx: TickContext): {
  spreadStacks: ActiveSpreadStack[];
  pendingSpreadStacks: PendingSpreadStack[];
} {
  const { players, log, time, randFloat, randInt } = ctx;
  const remainingPendingSpreadStacks: PendingSpreadStack[] = [];
  const spreadStacks: ActiveSpreadStack[] = ctx.world.spreadStacks.map(s => ({ ...s }));
  for (const ps of ctx.world.pendingSpreadStacks) {
    if (ps.t <= time) {
      const shown = ps.shown === "random" ? (randFloat() < 0.5 ? "spread" : "stack") : ps.shown;
      const inverted = ps.questionMark ?? (ps.rng ? randFloat() < 0.5 : false);
      // One marked member per group -> one stack circle each (e.g. two groups = two stacks).
      const markedPlayerIds = ps.stack.groups.map(group => group[randInt(group.length)]);
      spreadStacks.push({
        id: ps.id,
        name: ps.name,
        telegraphStart: ps.t,
        resolveAt: ps.t + ps.telegraph,
        shown,
        inverted,
        markedPlayerIds,
        spread: ps.spread,
        stack: ps.stack,
        damageType: ps.damageType,
        ringColor: ps.ringColor,
        ringHeight: ps.ringHeight,
        showCastBar: ps.showCastBar,
        resolved: false,
      });
    } else {
      remainingPendingSpreadStacks.push(ps);
    }
  }

  for (const ss of spreadStacks) {
    if (!ss.resolved && ss.resolveAt <= time) {
      const actual = ss.inverted ? (ss.shown === "spread" ? "stack" : "spread") : ss.shown;
      if (actual === "spread") {
        // Each alive player drops a personal AOE; a player eats it once per circle they stand in.
        const owners = players.filter(p => p.alive);
        for (const owner of owners) {
          const circle: AOEShape = { kind: "circle", center: owner.pos, radius: ss.spread.radius };
          for (const player of players) {
            if (!player.alive || !pointInShape(circle, player.pos)) continue;
            applyMechanicDamage(player, ss.spread.damage, ss.damageType, time);
            log.push({ t: time, mechanic: ss.name, playerId: player.id, event: "hit" });
          }
        }
      } else {
        // One shared stack per marked player (one per group). For each: soakers inside split the
        // hit; fewer than requiredCount -> that stack fails and each soaker eats the full damage.
        let allSucceeded = true;
        for (const id of ss.markedPlayerIds) {
          const marked = players.find(p => p.id === id);
          if (!marked?.alive) continue;
          const circle: AOEShape = { kind: "circle", center: marked.pos, radius: ss.stack.radius };
          const soakers = players.filter(p => p.alive && pointInShape(circle, p.pos));
          const success = soakers.length >= ss.stack.requiredCount;
          if (!success) allSucceeded = false;
          const per = success ? ss.stack.damage / soakers.length : ss.stack.damage;
          for (const player of soakers) {
            applyMechanicDamage(player, per, ss.damageType, time);
            log.push({ t: time, mechanic: ss.name, playerId: player.id, event: "hit" });
          }
        }
        ss.outcome = allSucceeded ? "success" : "failure";
      }
      ss.resolved = true;
    }
  }

  // Keep briefly after resolve so the renderer can flash the hit.
  return {
    spreadStacks: cullResolved(spreadStacks, time, TARGETED_LINGER),
    pendingSpreadStacks: remainingPendingSpreadStacks,
  };
}
