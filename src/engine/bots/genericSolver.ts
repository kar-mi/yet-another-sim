import type { Vec2 } from "@shared/math";
import { add, sub, scale, normalize, length, dot } from "@shared/math";
import { cos, sin } from "@shared/dmath";
import type { FrameRef, GenericSolverRule, Player, World } from "@model/types";
import { pointInShape } from "../shapes";
import { urgentSlot } from "@status";
import { aoeCanHitPlayer } from "../systems/helpers";

export type ResolvedMechanic = {
  resolvedId: string;
  telegraphStart: number;
  resolveAt: number;
  labels?: string[];
  group?: string;
  pos?: Vec2;
};

export function resolvedMechanics(world: World): ResolvedMechanic[] {
  const out: ResolvedMechanic[] = [];

  for (const m of world.active) {
    if (!m.resolved) out.push({ resolvedId: m.id, telegraphStart: m.telegraphStart, resolveAt: m.resolveAt, labels: m.labels, group: m.group });
  }
  for (const t of world.towers) {
    if (!t.resolved) out.push({ resolvedId: t.id, telegraphStart: t.telegraphStart, resolveAt: t.resolveAt, labels: t.labels, group: t.group, pos: t.pos });
  }
  for (const t of world.pendingTowers) {
    out.push({ resolvedId: t.id, telegraphStart: t.t, resolveAt: t.t + t.telegraph, labels: t.labels, group: t.group, pos: t.pos });
  }

  for (const inv of world.inversions) {
    if (inv.resolved) continue;
    const mode = inv.inverted ? "inverted" : "shown";
    const variant = inv.variantB ? "b" : "a";
    out.push({ resolvedId: `${inv.id}.${mode}.${variant}`, telegraphStart: inv.telegraphStart, resolveAt: inv.resolveAt });
  }

  for (const ss of world.spreadStacks) {
    if (ss.resolved) continue;
    const actual = ss.inverted ? (ss.shown === "spread" ? "stack" : "spread") : ss.shown;
    out.push({ resolvedId: `${ss.id}.${actual}`, telegraphStart: ss.telegraphStart, resolveAt: ss.resolveAt });
  }

  for (const gaze of world.gazes) {
    if (gaze.resolved) continue;
    out.push({ resolvedId: `${gaze.id}.${gaze.reverse ? "reverse" : "normal"}`, telegraphStart: gaze.telegraphStart, resolveAt: gaze.resolveAt });
  }

  for (const gm of world.groupMechanics) {
    if (gm.resolved) continue;
    const index = world.groupChoices[gm.id];
    if (index === undefined) continue;
    out.push({ resolvedId: `${gm.id}.g${index}`, telegraphStart: gm.telegraphStart, resolveAt: gm.resolveAt });
  }

  for (const lc of world.limitCuts) {
    out.push({ resolvedId: lc.id, telegraphStart: lc.appliedAt, resolveAt: lc.appliedAt + lc.duration });
  }

  return out;
}

function prefixMatches(ruleSegments: string[], resolvedId: string): boolean {
  const idSegments = resolvedId.split(".");
  if (ruleSegments.length > idSegments.length) return false;
  return ruleSegments.every((segment, i) => segment === idSegments[i]);
}

function idOrLabelMatches(ruleId: string, resolvedId: string, labels?: string[]): boolean {
  return prefixMatches(ruleId.split("."), resolvedId) || (labels?.includes(ruleId) ?? false);
}

function mechanicMatches(id: string, mechanic: ResolvedMechanic): boolean {
  return idOrLabelMatches(id, mechanic.resolvedId, mechanic.labels);
}

export function holdUntilFromResolves(world: World, previousTime: number): number | undefined {
  const holds = world.botSolvers?.holds;
  if (!holds?.length) return undefined;
  const time = world.time;
  const resolvedThisTick: { id: string; labels?: string[] }[] = [];
  for (const t of world.towers) if (t.resolved && t.resolveAt > previousTime && t.resolveAt <= time) resolvedThisTick.push({ id: t.id, labels: t.labels });
  for (const m of world.active) if (m.resolved && m.resolveAt > previousTime && m.resolveAt <= time) resolvedThisTick.push({ id: m.id, labels: m.labels });
  if (resolvedThisTick.length === 0) return undefined;

  let until: number | undefined;
  for (const hold of holds) {
    const ids = Array.isArray(hold.mechanic) ? hold.mechanic : [hold.mechanic];
    const triggered = resolvedThisTick.some(r => ids.some(id => idOrLabelMatches(id, r.id, r.labels)));
    if (triggered) until = Math.max(until ?? 0, time + hold.duration);
  }
  return until;
}

function activeLimitCutNumber(player: Player, time: number): number | undefined {
  const effect = player.effects.find(e =>
    e.limitCutNumber !== undefined && e.appliedAt <= time && e.appliedAt + e.duration > time);
  return effect?.limitCutNumber;
}

function limitCutSpot(player: Player, world: World, spots: Vec2[], mechanicId: string): Vec2 | undefined {
  const lc = world.limitCuts.find(l => l.id === mechanicId);
  if (!lc) return undefined;
  const n = activeLimitCutNumber(player, world.time);
  if (n === undefined) return undefined;
  const spot = spots[n - 1];
  if (!spot) return undefined;
  return frameToWorld(spot, lc.north, lc.clockwise ? 1 : -1);
}

function hasActiveDebuff(player: Player, name: string, time: number): boolean {
  return player.effects.some(effect =>
    effect.name === name && effect.appliedAt <= time && effect.appliedAt + effect.duration > time);
}

function hasAllDebuffs(player: Player, debuff: string | string[], time: number): boolean {
  const names = Array.isArray(debuff) ? debuff : [debuff];
  return names.every(name => hasActiveDebuff(player, name, time));
}

function partyHasAllDebuffs(world: World, debuff: string | string[], time: number): boolean {
  const names = Array.isArray(debuff) ? debuff : [debuff];
  return names.every(name => world.players.some(player => player.alive && hasActiveDebuff(player, name, time)));
}

function directionName(direction: [number, number]): "up" | "down" | "left" | "right" | undefined {
  const [x, z] = direction;
  if (x === 0 && z === 1) return "up";
  if (x === 0 && z === -1) return "down";
  if (x === -1 && z === 0) return "left";
  if (x === 1 && z === 0) return "right";
  return undefined;
}

function plantComboKey(player: Player, world: World): string | undefined {
  if (urgentSlot(player) === undefined) return undefined;
  const combo = world.plantPlan[player.id];
  if (!combo?.length) return undefined;
  const names = combo.map(directionName);
  if (names.some(name => name === undefined)) return undefined;
  return names.join(" ");
}

function ruleMatches(rule: GenericSolverRule, player: Player, world: World, mechanics: ResolvedMechanic[]): ResolvedMechanic[] | null {
  const time = world.time;
  if (rule.startAt !== undefined && time < rule.startAt) return null;
  if (rule.endAt !== undefined && time > rule.endAt) return null;

  const { mechanic, selectedEvent, role, debuff, partyDebuff, partnerDebuff, soaks, plant, plantSlot, endingFacing } = rule.when;
  if (role !== undefined && !(Array.isArray(role) ? role : [role]).includes(player.role)) return null;
  if (debuff !== undefined && !hasAllDebuffs(player, debuff, time)) return null;
  if (partyDebuff !== undefined && !partyHasAllDebuffs(world, partyDebuff, time)) return null;
  if (endingFacing !== undefined && world.endingOffsets?.[endingFacing.event] !== endingFacing.offset) return null;
  if (partnerDebuff !== undefined) {
    const partner = world.players.find(p => p.id === world.partners?.[player.id]);
    if (!partner || !hasAllDebuffs(partner, partnerDebuff, time)) return null;
  }
  if (plant !== undefined) {
    if (plantComboKey(player, world) !== plant) return null;
    if (plantSlot !== undefined && urgentSlot(player) !== plantSlot) return null;
  }
  if (selectedEvent !== undefined) {
    const required = Array.isArray(selectedEvent) ? selectedEvent : [selectedEvent];
    const selected = [
      ...world.pending.map(event => ({ id: event.id, labels: event.labels })),
      ...world.active.filter(event => !event.resolved).map(event => ({ id: event.id, labels: event.labels })),
    ];
    if (!required.every(id => selected.some(event => idOrLabelMatches(id, event.id, event.labels)))) return null;
  }

  let matched: ResolvedMechanic[] = [];
  if (mechanic !== undefined) {
    const required = Array.isArray(mechanic) ? mechanic : [mechanic];
    for (const id of required) {
      const live = mechanics.filter(m => m.telegraphStart <= time && time <= m.resolveAt && mechanicMatches(id, m));
      if (live.length === 0) return null;
      if (matched.length === 0) matched = live;
    }
  }

  if (soaks !== undefined) {
    const group = matched[0]?.group;
    if (group === undefined) return null;
    const playerGroup = world.playerGroups?.[player.id];
    if (soaks ? playerGroup !== group : playerGroup === group) return null;
  }

  return matched;
}

function refToVec(ref: FrameRef, world: World): Vec2 | undefined {
  if (typeof ref === "string") return world.eventPositions?.[ref];
  if ("crystal" in ref) return world.crystals?.find(c => c.element === ref.crystal)?.pos;
  if ("blackHoleTether" in ref) {
    return world.blackHoleTetherOrder?.[ref.blackHoleTether.hazardId]?.[ref.blackHoleTether.order];
  }
  if ("blackHoleOrb" in ref) {
    return world.blackHoleTethers?.[ref.blackHoleOrb.hazardId]?.positions[ref.blackHoleOrb.index];
  }
  const boss = ref.boss.id
    ? world.bosses?.find(candidate => candidate.id === ref.boss.id)
    : world.boss;
  if (!boss) return undefined;
  return ref.boss.from === "facing"
    ? { x: sin(boss.facing), z: cos(boss.facing) }
    : boss.pos;
}

function frameNorth(frame: NonNullable<GenericSolverRule["frame"]>, matched: ResolvedMechanic[], world: World): Vec2 | undefined {
  let sum: Vec2 = { x: 0, z: 0 };
  if (frame === "matched") {
    for (const m of matched) if (m.pos) sum = add(sum, m.pos);
  } else {
    const facingRef = frame.find(ref =>
      typeof ref !== "string" && "boss" in ref && ref.boss.from === "facing");
    if (facingRef) {
      const facing = refToVec(facingRef, world);
      return facing ? normalize(facing) : undefined;
    }
    for (const ref of frame) {
      const pos = refToVec(ref, world);
      if (pos) sum = add(sum, pos);
    }
  }
  if (sum.x === 0 && sum.z === 0) return undefined;
  return normalize(sum);
}

type GenericFrame = NonNullable<GenericSolverRule["frame"]>;

export function genericFrameNorth(frame: Exclude<GenericFrame, "matched">, world: World): Vec2 | undefined {
  return frameNorth(frame, [], world);
}

function facingAndOthers(frame: Exclude<GenericFrame, "matched">, world: World): { facing: Vec2; others: Vec2 } | undefined {
  const facingIndex = frame.findIndex(ref =>
    typeof ref !== "string" && "boss" in ref && ref.boss.from === "facing");
  if (facingIndex < 0) return undefined;
  const facing = refToVec(frame[facingIndex]!, world);
  if (!facing) return undefined;

  let others: Vec2 = { x: 0, z: 0 };
  for (const [index, ref] of frame.entries()) {
    if (index === facingIndex) continue;
    const pos = refToVec(ref, world);
    if (pos) others = add(others, pos);
  }
  return { facing, others };
}

export function genericFrameRightSign(frame: Exclude<GenericFrame, "matched">, world: World): 1 | -1 {
  const resolved = facingAndOthers(frame, world);
  if (!resolved) return 1;
  const { facing, others } = resolved;
  const bossRight = { x: facing.z, z: -facing.x };
  return others.x * bossRight.x + others.z * bossRight.z < 0 ? -1 : 1;
}

export function genericFrameForwardSign(frame: Exclude<GenericFrame, "matched">, world: World): 1 | -1 {
  const resolved = facingAndOthers(frame, world);
  if (!resolved) return 1;
  const { facing, others } = resolved;
  return others.x * facing.x + others.z * facing.z < 0 ? -1 : 1;
}

export function genericRuleFrameNorth(
  rule: GenericSolverRule,
  player: Player,
  world: World,
  mechanics?: ResolvedMechanic[],
): Vec2 | undefined {
  if (rule.frame === undefined) return undefined;
  if (rule.frame !== "matched") return genericFrameNorth(rule.frame, world);
  const matched = ruleMatches(rule, player, world, mechanics ?? resolvedMechanics(world));
  return matched === null ? undefined : frameNorth(rule.frame, matched, world);
}

function frameToWorld(spot: Vec2, north: Vec2, rightSign: 1 | -1 = 1, forwardSign: 1 | -1 = 1): Vec2 {
  const right: Vec2 = { x: rightSign * north.z, z: rightSign * -north.x };
  return {
    x: spot.x * right.x + forwardSign * spot.z * north.x,
    z: spot.x * right.z + forwardSign * spot.z * north.z,
  };
}

function arenaRadius(world: World): number | undefined {
  let radius: number | undefined;
  for (const zone of world.arena?.zones ?? []) {
    if (zone.kind === "circle") radius = Math.max(radius ?? 0, zone.radius);
  }
  return radius;
}

const EDGE_EPS = 1e-9;
function nearestSafeEdge(spec: NonNullable<GenericSolverRule["nearestEdge"]>, world: World): Vec2 | undefined {
  const from = refToVec(spec.from, world);
  const axis = refToVec(spec.avoid, world);
  const radius = arenaRadius(world);
  if (!from || !axis || radius === undefined) return undefined;
  const facing = normalize(axis);
  if (facing.x === 0 && facing.z === 0) return undefined;
  const right: Vec2 = { x: facing.z, z: -facing.x };
  const { clearance } = spec;

  const candidates: Vec2[] = [];
  const fromLen = length(from);
  if (fromLen > 0) candidates.push(scale(from, radius / fromLen));
  if (radius * radius >= clearance * clearance) {
    const forward = Math.sqrt(radius * radius - clearance * clearance);
    for (const a of [clearance, -clearance]) {
      for (const b of [forward, -forward]) {
        candidates.push({ x: a * right.x + b * facing.x, z: a * right.z + b * facing.z });
      }
    }
  }

  const fromSide = Math.sign(dot(from, right));
  let best: Vec2 | undefined;
  let bestKey: [number, number, number] | undefined;
  for (const p of candidates) {
    if (Math.abs(dot(p, right)) < clearance - EDGE_EPS) continue;
    const sameSidePenalty = fromSide !== 0 && Math.sign(dot(p, right)) === fromSide ? 0 : 1;
    const key: [number, number, number] = [length(sub(p, from)), sameSidePenalty, -dot(p, facing)];
    if (!bestKey || key[0] < bestKey[0] - EDGE_EPS
      || (Math.abs(key[0] - bestKey[0]) <= EDGE_EPS && (key[1] < bestKey[1]
        || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = p;
      bestKey = key;
    }
  }
  return best;
}

type TetherState = { source: Vec2; held: true } | { source: Vec2; held: false; midpoint: Vec2 };

export const TETHER_SOURCE_PULL = 1;

function pullTowardSource(aim: Vec2, source: Vec2): Vec2 {
  const toSource = sub(source, aim);
  const dist = length(toSource);
  if (dist <= TETHER_SOURCE_PULL) return source;
  return add(aim, scale(normalize(toSource), TETHER_SOURCE_PULL));
}

function tetherState(
  spec: NonNullable<GenericSolverRule["tetherMidpoint"]>,
  player: Player,
  world: World,
): TetherState | undefined {
  const source = world.blackHoleTetherOrder?.[spec.hazardId]?.[spec.order];
  if (!source) return undefined;
  const tether = world.tetherSources.find(ts =>
    !ts.finalized && ts.pos.x === source.x && ts.pos.z === source.z);
  if (!tether?.tetheredPlayerId) return undefined;
  if (tether.tetheredPlayerId === player.id) return { source, held: true };
  const endpoint = world.players.find(p => p.id === tether.tetheredPlayerId)?.pos;
  return endpoint ? { source, held: false, midpoint: scale(add(source, endpoint), 0.5) } : undefined;
}

function originOffset(rule: GenericSolverRule, world: World): Vec2 | undefined {
  const bossId = rule.origin?.boss;
  if (bossId === undefined) return { x: 0, z: 0 };
  return world.bosses.find(boss => boss.id === bossId)?.pos;
}

export function genericSolverWaypoint(
  player: Player,
  world: World,
  mechanics?: ResolvedMechanic[],
): Vec2 | undefined {
  const rules = world.botSolvers?.generic;
  if (!rules?.length) return undefined;

  mechanics ??= resolvedMechanics(world);
  for (const rule of rules) {
    const matched = ruleMatches(rule, player, world, mechanics);
    if (matched === null) continue;
    if (rule.freeze) return player.pos;
    if (rule.nearestEdge) {
      const edge = nearestSafeEdge(rule.nearestEdge, world);
      if (edge) return edge;
      continue;
    }
    let tetherSource: Vec2 | undefined;
    if (rule.tetherMidpoint) {
      const state = tetherState(rule.tetherMidpoint, player, world);
      if (!state) continue;
      if (!state.held) return state.midpoint;
      if (rule.spot === undefined && rule.spots === undefined) continue;
      tetherSource = state.source;
    }
    if (rule.limitCutSpread) {
      const mechanicId = matched[0]?.resolvedId;
      if (mechanicId) {
        const placement = limitCutSpot(player, world, rule.limitCutSpread.spots, mechanicId);
        if (placement) return placement;
      }
      continue;
    }
    if (rule.safeSpots) {
      let candidates = rule.safeSpots;
      if (rule.frame !== undefined) {
        const north = frameNorth(rule.frame, matched, world);
        if (!north) continue;
        const rightSign = rule.mirrorLateral && rule.frame !== "matched"
          ? genericFrameRightSign(rule.frame, world)
          : 1;
        const forwardSign = rule.mirrorForward && rule.frame !== "matched"
          ? genericFrameForwardSign(rule.frame, world)
          : 1;
        const origin = originOffset(rule, world);
        if (!origin) continue;
        candidates = rule.safeSpots.map(spot => add(origin, frameToWorld(spot, north, rightSign, forwardSign)));
      }
      const required = rule.when.mechanic === undefined ? [] : Array.isArray(rule.when.mechanic) ? rule.when.mechanic : [rule.when.mechanic];
      const horizon = rule.dangerHorizon;
      const dangers = world.active.filter(event => !event.resolved
        && event.telegraphStart <= world.time && world.time <= event.resolveAt
        && (horizon === undefined || event.resolveAt - world.time <= horizon)
        && required.some(id => idOrLabelMatches(id, event.id, event.labels))
        && aoeCanHitPlayer(event, player, world.time));
      const safe = candidates
        .filter(target => dangers.every(event => !pointInShape(event.shape, target)))
        .sort((a, b) => length(sub(a, player.pos)) - length(sub(b, player.pos)))[0];
      if (safe) return safe;
      continue;
    }
    const spot = rule.spots?.[player.id] ?? rule.spot;
    if (!spot) continue;
    if (rule.frame === undefined) return tetherSource ? pullTowardSource(spot, tetherSource) : spot;
    const north = frameNorth(rule.frame, matched, world);
    if (!north) continue;
    const rightSign = rule.mirrorLateral && rule.frame !== "matched"
      ? genericFrameRightSign(rule.frame, world)
      : 1;
    const forwardSign = rule.mirrorForward && rule.frame !== "matched"
      ? genericFrameForwardSign(rule.frame, world)
      : 1;
    const origin = originOffset(rule, world);
    if (!origin) continue;
    const target = add(origin, frameToWorld(spot, north, rightSign, forwardSign));
    return tetherSource ? pullTowardSource(target, tetherSource) : target;
  }
  return undefined;
}
