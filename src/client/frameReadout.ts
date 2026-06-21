import type { GenericSolverRule, Player, World } from "@shared/types";
import type { Vec2 } from "@shared/math";
import { genericFrameNorth, genericRuleFrameNorth } from "../engine/genericSolver";

export type PositionFrameOption = {
  key: string;
  label: string;
  descriptor?: string;
  north?: Vec2;
};

export type FramePositionReadout = {
  r: number;
  z: number;
  dist: number;
  angleDeg: number;
};

export function invertFramePosition(pos: Vec2, north: Vec2): FramePositionReadout {
  const right = { x: north.z, z: -north.x };
  const r = pos.x * right.x + pos.z * right.z;
  const z = pos.x * north.x + pos.z * north.z;
  return {
    r,
    z,
    dist: Math.sqrt(r * r + z * z),
    angleDeg: Math.atan2(r, z) * 180 / Math.PI,
  };
}

function mechanicLabel(rule: GenericSolverRule, index: number): string {
  const mechanic = rule.when.mechanic;
  if (Array.isArray(mechanic)) return mechanic.join(" + ");
  return mechanic ?? `rule ${index + 1}`;
}

export function positionFrameOptions(world: World, player: Player): PositionFrameOption[] {
  const options: PositionFrameOption[] = [{ key: "world", label: "World" }];
  const seen = new Set(["world"]);
  const push = (option: PositionFrameOption): void => {
    if (seen.has(option.key)) return;
    seen.add(option.key);
    options.push(option);
  };

  for (const boss of world.bosses) {
    for (const from of ["facing", "position"] as const) {
      const frame = { boss: { id: boss.id, from } } as const;
      push({
        key: `boss:${boss.id}:${from}`,
        label: `Boss: ${boss.id} — ${from}`,
        descriptor: `frame: { boss: { id: ${boss.id}, from: ${from} } }`,
        north: genericFrameNorth(frame, world),
      });
    }
  }

  for (const crystal of world.crystals) {
    const frame = { crystal: crystal.element } as const;
    push({
      key: `crystal:${crystal.element}`,
      label: `Crystal: ${crystal.element}`,
      descriptor: `frame: { crystal: ${crystal.element} }`,
      north: genericFrameNorth(frame, world),
    });
  }

  for (const [index, rule] of (world.botSolvers?.generic ?? []).entries()) {
    const frame = rule.frame;
    if (frame === undefined) continue;
    if (frame === "matched") {
      push({
        key: `matched:${index}`,
        label: `Matched: ${mechanicLabel(rule, index)}`,
        descriptor: "frame: matched",
        north: genericRuleFrameNorth(rule, player, world),
      });
    } else if (Array.isArray(frame)) {
      push({
        key: `events:${frame.join("|")}`,
        label: `Events: ${frame.join(" + ")}`,
        descriptor: `frame: [${frame.join(", ")}]`,
        north: genericFrameNorth(frame, world),
      });
    }
  }

  return options;
}
