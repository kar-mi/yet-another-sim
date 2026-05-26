import type { World, Player, Boss, Arena, ZoneShape, AOEShape, PendingEvent, PendingTether } from "../shared/types";
import { vec2 } from "../shared/math";
import type { RaidDef } from "./raidSchema";

function toVec2(arr: [number, number]) {
  return vec2(arr[0], arr[1]);
}

function toZoneShape(zone: RaidDef["arena"]["zones"][number]): ZoneShape {
  switch (zone.kind) {
    case "circle": return { kind: "circle", center: toVec2(zone.center), radius: zone.radius };
    case "rect": return { kind: "rect", center: toVec2(zone.center), width: zone.width, height: zone.height };
    case "polygon": return { kind: "polygon", vertices: zone.vertices.map(toVec2) };
  }
}

type AOEEventDef = Extract<RaidDef["events"][number], { type: "aoe" }>;

function toAOEShape(shape: AOEEventDef["shape"]): AOEShape {
  switch (shape.kind) {
    case "circle": return { kind: "circle", center: toVec2(shape.center), radius: shape.radius };
    case "donut": return { kind: "donut", center: toVec2(shape.center), inner: shape.inner, outer: shape.outer };
    case "cone": return { kind: "cone", origin: toVec2(shape.origin), direction: toVec2(shape.direction), angleDeg: shape.angleDeg, length: shape.length };
    case "rect": return { kind: "rect", origin: toVec2(shape.origin), direction: toVec2(shape.direction), width: shape.width, length: shape.length };
  }
}

export function createWorld(raid: RaidDef): World {
  const arena: Arena = { zones: raid.arena.zones.map(toZoneShape) };

  const players: Player[] = raid.players.map(p => ({
    id: p.id,
    role: p.role,
    control: p.control,
    pattern: p.pattern?.map(waypoint => ({ t: waypoint.t, pos: toVec2(waypoint.pos) })),
    pos: toVec2(p.spawn),
    y: 0,
    verticalVelocity: 0,
    facing: 0,
    hp: 100,
    maxHp: 100,
    mp: 10000,
    maxMp: 10000,
    sprintActive: 0,
    sprintCooldown: 0,
    alive: true,
    effects: [],
  }));

  const boss: Boss = { id: "boss", pos: { x: 0, z: 0 }, hp: 1000, maxHp: 1000, radius: 3 };

  const pending: PendingEvent[] = [];
  const pendingTethers: PendingTether[] = [];

  for (const [index, e] of raid.events.entries()) {
    if (e.type === "tether_source") {
      pendingTethers.push({
        id: `tether-${index}`,
        t: e.t,
        pos: toVec2(e.pos),
        finalizeAfter: e.finalizeAfter,
        tetherKind: e.tetherKind,
        buffName: e.buffName,
      });
    } else {
      pending.push({
        id: `event-${index}`,
        t: e.t,
        name: e.name,
        shape: toAOEShape(e.shape),
        telegraph: e.telegraph,
        damage: e.damage,
        showCastBar: e.showCastBar ?? false,
      });
    }
  }

  return {
    time: 0,
    status: "running",
    arena,
    players,
    boss,
    active: [],
    pending,
    log: [],
    duration: raid.duration,
    tetherSources: [],
    pendingTethers,
  };
}
