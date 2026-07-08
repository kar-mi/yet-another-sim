import { cos, sin } from "@shared/dmath";
import { vec2, type Vec2 } from "@shared/math";
import type { World } from "@shared/types";
import type { RaidDef } from "./raidSchema";

type AuthoredSpot = { x: number; z: number } | { r: number; z: number }
  | { dist: number; angleDeg: number };

export function toBotSolvers(raid: RaidDef): World["botSolvers"] {
  const generic = raid.botSolvers?.generic;
  const holds = raid.botSolvers?.holds;
  if (!generic && !holds) return undefined;

  const toSpot = (spot: AuthoredSpot): Vec2 => {
    if ("angleDeg" in spot) {
      const angle = spot.angleDeg * Math.PI / 180;
      return vec2(spot.dist * sin(angle), spot.dist * cos(angle));
    }
    return "x" in spot ? vec2(spot.x, spot.z) : vec2(spot.r, spot.z);
  };
  const toSpots = (spots: Record<string, AuthoredSpot>) =>
    Object.fromEntries(Object.entries(spots).map(([id, spot]) => [id, toSpot(spot)]));

  return {
    generic: generic?.map(rule => ({
      when: { ...rule.when },
      startAt: rule.startAt,
      endAt: rule.endAt,
      frame: rule.frame,
      origin: rule.origin,
      mirrorLateral: rule.mirrorLateral,
      mirrorForward: rule.mirrorForward,
      spots: rule.spots && toSpots(rule.spots),
      spot: rule.spot && toSpot(rule.spot),
      limitCutSpread: rule.limitCutSpread && { spots: rule.limitCutSpread.spots.map(toSpot) },
      freeze: rule.freeze,
      nearestEdge: rule.nearestEdge,
      tetherMidpoint: rule.tetherMidpoint,
    })),
    holds: holds?.map(hold => ({ ...hold })),
  };
}
