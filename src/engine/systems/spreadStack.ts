import type { TickContext } from "./context";
import type { ActiveSpreadStack, PendingSpreadStack, AOEShape } from "@model/types";
import { hitPlayersInShape, resolveStackShare } from "./strikes";
import { mechanicSource } from "./damageLog";
import { cullResolved } from "./util";
import { TARGETED_LINGER } from "@shared/constants";

export function resolveSpreadStacks(ctx: TickContext): {
  spreadStacks: ActiveSpreadStack[];
  pendingSpreadStacks: PendingSpreadStack[];
} {
  const { players, time, randFloat, randInt } = ctx;
  const remainingPendingSpreadStacks: PendingSpreadStack[] = [];
  const spreadStacks: ActiveSpreadStack[] = ctx.world.spreadStacks.map(s => ({ ...s }));
  for (const ps of ctx.world.pendingSpreadStacks) {
    if (ps.t <= time) {
      const shown = ps.shown === "random" ? (randFloat() < 0.5 ? "spread" : "stack") : ps.shown;
      const inverted = ps.questionMark ?? (ps.rng ? randFloat() < 0.5 : false);
      const markedPlayerIds = ps.stackCarriers
        ? players.filter(p => p.alive && p.effects.some(e => e.name === ps.stackCarriers && e.appliedAt + e.duration > time)).map(p => p.id)
        : ps.stack.groups.map(group => group[randInt(group.length)]);
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
        spreadPlayerIds: ps.spreadCarriers
          ? players.filter(p => p.alive && p.effects.some(e => e.name === ps.spreadCarriers && e.appliedAt + e.duration > time)).map(p => p.id)
          : undefined,
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
      if (ss.spreadPlayerIds) {
        const stackIds = ss.inverted ? ss.spreadPlayerIds : ss.markedPlayerIds;
        const spreadIds = ss.inverted ? ss.markedPlayerIds : ss.spreadPlayerIds;
        for (const id of spreadIds) {
          const owner = players.find(p => p.id === id && p.alive);
          if (!owner) continue;
          const circle: AOEShape = { kind: "circle", center: owner.pos, radius: ss.spread.radius };
          hitPlayersInShape(ctx, circle, ss.spread.damage, ss.damageType, mechanicSource(ctx, ss.id, ss.name, "spread"));
        }
        for (const id of stackIds) {
          const marked = players.find(p => p.id === id && p.alive);
          if (!marked) continue;
          const circle: AOEShape = { kind: "circle", center: marked.pos, radius: ss.stack.radius };
          resolveStackShare(ctx, circle, ss.stack, ss.damageType, mechanicSource(ctx, ss.id, ss.name, "stack"));
        }
        ss.outcome = "success";
      } else if (actual === "spread") {
        const owners = players.filter(p => p.alive);
        for (const owner of owners) {
          const circle: AOEShape = { kind: "circle", center: owner.pos, radius: ss.spread.radius };
          hitPlayersInShape(ctx, circle, ss.spread.damage, ss.damageType, mechanicSource(ctx, ss.id, ss.name, "spread"));
        }
      } else {
        let allSucceeded = true;
        for (const id of ss.markedPlayerIds) {
          const marked = players.find(p => p.id === id);
          if (!marked?.alive) continue;
          const circle: AOEShape = { kind: "circle", center: marked.pos, radius: ss.stack.radius };
          if (!resolveStackShare(ctx, circle, ss.stack, ss.damageType, mechanicSource(ctx, ss.id, ss.name, "stack"))) allSucceeded = false;
        }
        ss.outcome = allSucceeded ? "success" : "failure";
      }
      ss.resolved = true;
    }
  }

  return {
    spreadStacks: cullResolved(spreadStacks, time, TARGETED_LINGER),
    pendingSpreadStacks: remainingPendingSpreadStacks,
  };
}
