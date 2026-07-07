import type { Vec2 } from "@shared/math";
import { add, sub, scale, normalize, length, dot } from "@shared/math";
import { cos, sin } from "@shared/dmath";
import type { FrameRef, GenericSolverRule, Player, World } from "@shared/types";

// A live unresolved mechanic the generic solver can match against. `labels`/`group`/`pos` are carried
// from the authored event (towers have a position; targeted/bait/aoe carry labels+group but no pos).
export type ResolvedMechanic = {
  resolvedId: string;
  telegraphStart: number;
  resolveAt: number;
  labels?: string[];
  group?: string;
  pos?: Vec2;
};

// Walk the unresolved active mechanics in the world and yield each one's resolved id (the base
// event id extended with dot-separated RNG-outcome segments) plus its telegraph->resolve window.
// Generic solver rules match these ids by segment prefix, so "lightning-1" matches any outcome.
export function resolvedMechanics(world: World): ResolvedMechanic[] {
  const out: ResolvedMechanic[] = [];

  // Plain (non-RNG) telegraphs: the resolved id is just the event id.
  for (const m of world.active) {
    if (!m.resolved) out.push({ resolvedId: m.id, telegraphStart: m.telegraphStart, resolveAt: m.resolveAt, labels: m.labels, group: m.group });
  }
  for (const t of world.towers) {
    if (!t.resolved) out.push({ resolvedId: t.id, telegraphStart: t.telegraphStart, resolveAt: t.resolveAt, labels: t.labels, group: t.group, pos: t.pos });
  }
  // Pending towers report their real telegraph window [t, t+telegraph] — the same window they
  // get once active. They only become live to the solver at activation (t), so a future wave's
  // window never bleeds back into the previous (now contiguous) wave's soak window.
  for (const t of world.pendingTowers) {
    out.push({ resolvedId: t.id, telegraphStart: t.t, resolveAt: t.t + t.telegraph, labels: t.labels, group: t.group, pos: t.pos });
  }

  // Inverse "?": id + .inverted/.shown + .a/.b (the rolled orientation).
  for (const inv of world.inversions) {
    if (inv.resolved) continue;
    const mode = inv.inverted ? "inverted" : "shown";
    const variant = inv.variantB ? "b" : "a";
    out.push({ resolvedId: `${inv.id}.${mode}.${variant}`, telegraphStart: inv.telegraphStart, resolveAt: inv.resolveAt });
  }

  // Spread/stack "?": id + the *actual* mode (inverted flips the shown mode), since bots solve the real answer.
  for (const ss of world.spreadStacks) {
    if (ss.resolved) continue;
    const actual = ss.inverted ? (ss.shown === "spread" ? "stack" : "spread") : ss.shown;
    out.push({ resolvedId: `${ss.id}.${actual}`, telegraphStart: ss.telegraphStart, resolveAt: ss.resolveAt });
  }

  // Gaze: id + .reverse/.normal.
  for (const gaze of world.gazes) {
    if (gaze.resolved) continue;
    out.push({ resolvedId: `${gaze.id}.${gaze.reverse ? "reverse" : "normal"}`, telegraphStart: gaze.telegraphStart, resolveAt: gaze.resolveAt });
  }

  // Group stack: id + .g<chosen group index> from world.groupChoices.
  for (const gm of world.groupMechanics) {
    if (gm.resolved) continue;
    const index = world.groupChoices[gm.id];
    if (index === undefined) continue;
    out.push({ resolvedId: `${gm.id}.g${index}`, telegraphStart: gm.telegraphStart, resolveAt: gm.resolveAt });
  }

  // Limit cut: live for its effect duration so when.mechanic / limitCutSpread rules can gate on it.
  for (const lc of world.limitCuts) {
    out.push({ resolvedId: lc.id, telegraphStart: lc.appliedAt, resolveAt: lc.appliedAt + lc.duration });
  }

  return out;
}

// rule mechanic "lightning-1.inverted" matches resolved id "lightning-1.inverted.b": split both on
// "." and require the rule's segments to be a prefix of the resolved id's segments.
function prefixMatches(ruleSegments: string[], resolvedId: string): boolean {
  const idSegments = resolvedId.split(".");
  if (ruleSegments.length > idSegments.length) return false;
  return ruleSegments.every((segment, i) => segment === idSegments[i]);
}

// A rule mechanic id matches a resolved id by segment-prefix OR an exact label match.
function idOrLabelMatches(ruleId: string, resolvedId: string, labels?: string[]): boolean {
  return prefixMatches(ruleId.split("."), resolvedId) || (labels?.includes(ruleId) ?? false);
}

// A rule mechanic id matches a live mechanic by segment-prefix on its id OR an exact label match.
function mechanicMatches(id: string, mechanic: ResolvedMechanic): boolean {
  return idOrLabelMatches(id, mechanic.resolvedId, mechanic.labels);
}

// New botSolvers.holds value after this tick: when any mechanic that crossed its resolveAt this tick
// (it still lingers in towers/active on the resolve tick) matches a hold rule, bots hold position for
// `duration` seconds. Returns the latest hold-until time triggered this tick, or undefined for none.
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

// The limit-cut number (1–8) of the bot's active limit-cut effect, or undefined when it carries none.
function activeLimitCutNumber(player: Player, time: number): number | undefined {
  const effect = player.effects.find(e =>
    e.limitCutNumber !== undefined && e.appliedAt <= time && e.appliedAt + e.duration > time);
  return effect?.limitCutNumber;
}

// World coords for a bot's numbered limit-cut spot: take the authored spot for the bot's number
// (relative to relative-north) and rotate it into the world frame using the matched limit cut's
// rotation basis — north is the relative-north vector and clockwise picks the lateral handedness.
// Returns undefined when the matched mechanic isn't a live limit cut, the bot has no number yet,
// or no spot was authored for it.
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

// Every listed effect name must be active on the player (a single string is treated as a 1-element list).
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

// The plant slot (short/long) of the bot's most urgent active plant debuff (earliest expiry).
function activePlantSlot(player: Player): number | undefined {
  let active: Player["effects"][number] | undefined;
  for (const effect of player.effects) {
    if (effect.behavior.kind !== "plant") continue;
    if (!active || effect.appliedAt + effect.duration < active.appliedAt + active.duration) {
      active = effect;
    }
  }
  return active?.plantSlot;
}

// The bot's assigned plant combo as a space-joined key (e.g. "right right"), or undefined when it
// has no active plant debuff / no assigned plan. Mirrors the placement keys in the generic rules.
function plantComboKey(player: Player, world: World): string | undefined {
  if (activePlantSlot(player) === undefined) return undefined;
  const combo = world.plantPlan[player.id];
  if (!combo?.length) return undefined;
  const names = combo.map(directionName);
  if (names.some(name => name === undefined)) return undefined;
  return names.join(" ");
}

// Evaluate a rule's `when` conditions for this bot. Returns the live mechanics matched by the first
// `when.mechanic` entry (for soaks / frame: "matched"), or null when the rule does not apply.
function ruleMatches(rule: GenericSolverRule, player: Player, world: World, mechanics: ResolvedMechanic[]): ResolvedMechanic[] | null {
  const time = world.time;
  if (rule.startAt !== undefined && time < rule.startAt) return null;
  if (rule.endAt !== undefined && time > rule.endAt) return null;

  // `static: true` adds no filter, making the rule always active subject to the optional clamps
  // and any other conditions. The schema requires the explicit flag instead of allowing an
  // accidental empty-object catch-all.
  const { mechanic, role, debuff, partyDebuff, partnerDebuff, soaks, plant, plantSlot, endingFacing } = rule.when;
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
    if (plantSlot !== undefined && activePlantSlot(player) !== plantSlot) return null;
  }

  // The live mechanics matched by the first listed id, used by soaks / frame. A list requires every
  // listed mechanic to be live at once (segment-prefix or label match within its window).
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

// Resolve a single frame reference to a world vector: a string is a positioned event id
// (static tower/event position); { crystal } is a resolved crystal's position; { boss } is the
// named/primary boss's facing direction or its position. Returns undefined when it can't resolve.
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

// Compute the frame's north vector: "matched" sums the positions of the live matched mechanics
// (a tower pair's bisector); otherwise sum each reference's resolved position (events, crystals,
// bosses). Returns undefined when no usable vector exists (the rule then yields no spot for this bot).
function frameNorth(frame: NonNullable<GenericSolverRule["frame"]>, matched: ResolvedMechanic[], world: World): Vec2 | undefined {
  let sum: Vec2 = { x: 0, z: 0 };
  if (frame === "matched") {
    for (const m of matched) if (m.pos) sum = add(sum, m.pos);
  } else {
    const facingRef = frame.find(ref =>
      typeof ref !== "string" && "boss" in ref && ref.boss.from === "facing");
    if (facingRef) {
      // Boss facing is already a direction, so it sets north directly. Other positioned refs in
      // the list only affect mirrorLateral handedness via genericFrameRightSign.
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

// Public frame-resolution helpers for client-side authoring tools. Keeping this logic here makes
// readouts use exactly the same north vectors as the solver instead of maintaining a second copy.
export function genericFrameNorth(frame: Exclude<GenericFrame, "matched">, world: World): Vec2 | undefined {
  return frameNorth(frame, [], world);
}

// Shared by genericFrameRightSign/genericFrameForwardSign: the primary boss-facing ref's vector
// plus the summed "other" refs' vectors, or undefined when no facing ref is present/resolvable.
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

// Preserve handedness for frames that combine a boss-facing direction with another positioned
// reference. The normal clockwise right axis is used when that reference is on the boss's right;
// it is flipped when the reference is on the boss's left.
export function genericFrameRightSign(frame: Exclude<GenericFrame, "matched">, world: World): 1 | -1 {
  const resolved = facingAndOthers(frame, world);
  if (!resolved) return 1;
  const { facing, others } = resolved;
  const bossRight = { x: facing.z, z: -facing.x };
  return others.x * bossRight.x + others.z * bossRight.z < 0 ? -1 : 1;
}

// Analogous to genericFrameRightSign, but mirrors the frame's forward/north axis instead of its
// lateral one: flips when the other references point behind the boss's own facing, rather than to
// its left. Combined with mirrorLateral, this lets a single authored spot stay safe against a
// second boss-facing-anchored hazard for any relative angle between the two facings (see
// GenericSolverRule.mirrorForward).
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

// Map a runtime frame coordinate to world space: x stores authored r (right/lateral), z is north.
function frameToWorld(spot: Vec2, north: Vec2, rightSign: 1 | -1 = 1, forwardSign: 1 | -1 = 1): Vec2 {
  const right: Vec2 = { x: rightSign * north.z, z: rightSign * -north.x };
  return {
    x: spot.x * right.x + forwardSign * spot.z * north.x,
    z: spot.x * right.z + forwardSign * spot.z * north.z,
  };
}

// The arena boundary radius: the largest circle zone in the arena (the outer wall).
function arenaRadius(world: World): number | undefined {
  let radius: number | undefined;
  for (const zone of world.arena?.zones ?? []) {
    if (zone.kind === "circle") radius = Math.max(radius ?? 0, zone.radius);
  }
  return radius;
}

// Nearest arena-edge point to `from` that stays `clearance` yalms clear of the `avoid` line's axis.
// The axis (a boss facing) runs through arena centre, so "in the line" means |lateral| < clearance
// where lateral = dot(p, right). Candidates are `from` projected radially to the wall plus the four
// wall points where |lateral| == clearance; keep the ones outside the line and return the nearest to
// `from`. Ties (equidistant band-edge points) break to the point on `from`'s own side of the line,
// then toward the axis's forward direction — deterministic, seed-independent. Falls through
// (undefined) when either ref or the arena radius can't be resolved.
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

  const fromSide = Math.sign(dot(from, right)); // 0 when `from` sits on the axis
  let best: Vec2 | undefined;
  let bestKey: [number, number, number] | undefined;
  for (const p of candidates) {
    if (Math.abs(dot(p, right)) < clearance - EDGE_EPS) continue; // inside the line
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

function originOffset(rule: GenericSolverRule, world: World): Vec2 | undefined {
  const bossId = rule.origin?.boss;
  if (bossId === undefined) return { x: 0, z: 0 };
  return world.bosses.find(boss => boss.id === bossId)?.pos;
}

// Generic, data-driven bot solver: iterate world.botSolvers.generic in order; the first rule whose
// conditions all match and that yields a spot for this bot wins. Returns undefined when no rule
// applies, letting the caller fall back to authored waypoints.
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
      continue; // refs unresolved: fall through to the next rule
    }
    if (rule.limitCutSpread) {
      // The matched mechanic (required when.mechanic) identifies which limit cut supplies the basis.
      const mechanicId = matched[0]?.resolvedId;
      if (mechanicId) {
        const placement = limitCutSpot(player, world, rule.limitCutSpread.spots, mechanicId);
        if (placement) return placement;
      }
      continue; // bot has no number yet: fall through to the next rule
    }
    const spot = rule.spots?.[player.id] ?? rule.spot;
    if (!spot) continue;
    if (rule.frame === undefined) return spot;
    const north = frameNorth(rule.frame, matched, world);
    if (!north) continue; // frame uncomputable: fall through to the next rule
    const rightSign = rule.mirrorLateral && rule.frame !== "matched"
      ? genericFrameRightSign(rule.frame, world)
      : 1;
    const forwardSign = rule.mirrorForward && rule.frame !== "matched"
      ? genericFrameForwardSign(rule.frame, world)
      : 1;
    const origin = originOffset(rule, world);
    if (!origin) continue;
    return add(origin, frameToWorld(spot, north, rightSign, forwardSign));
  }
  return undefined;
}
