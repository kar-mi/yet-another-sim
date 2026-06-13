import type { Vec2 } from "@shared/math";
import { add, normalize } from "@shared/math";
import type { GenericSolverRule, Player, World } from "@shared/types";

// A live unresolved mechanic the generic solver can match against. `labels`/`group`/`pos` are carried
// from the authored event (towers have a position; targeted/bait/aoe carry labels+group but no pos).
type ResolvedMechanic = {
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
  for (const t of world.pendingTowers) {
    out.push({ resolvedId: t.id, telegraphStart: t.t - t.telegraph, resolveAt: t.t, labels: t.labels, group: t.group, pos: t.pos });
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

  return out;
}

// rule mechanic "lightning-1.inverted" matches resolved id "lightning-1.inverted.b": split both on
// "." and require the rule's segments to be a prefix of the resolved id's segments.
function prefixMatches(ruleSegments: string[], resolvedId: string): boolean {
  const idSegments = resolvedId.split(".");
  if (ruleSegments.length > idSegments.length) return false;
  return ruleSegments.every((segment, i) => segment === idSegments[i]);
}

// A rule mechanic id matches a live mechanic by segment-prefix on its id OR an exact label match.
function mechanicMatches(id: string, mechanic: ResolvedMechanic): boolean {
  return prefixMatches(id.split("."), mechanic.resolvedId) || (mechanic.labels?.includes(id) ?? false);
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

  const { mechanic, role, debuff, partnerDebuff, soaks, plant, plantSlot } = rule.when;
  if (role !== undefined && player.role !== role) return null;
  if (debuff !== undefined && !hasAllDebuffs(player, debuff, time)) return null;
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

// Compute the frame's north vector: "matched" sums the positions of the live matched mechanics
// (a tower pair's bisector); a list sums those events' static positions. Returns undefined when no
// positioned event contributes (the rule then yields no spot for this bot).
function frameNorth(frame: "matched" | string[], matched: ResolvedMechanic[], world: World): Vec2 | undefined {
  let sum: Vec2 = { x: 0, z: 0 };
  if (frame === "matched") {
    for (const m of matched) if (m.pos) sum = add(sum, m.pos);
  } else {
    for (const id of frame) {
      const pos = world.eventPositions?.[id];
      if (pos) sum = add(sum, pos);
    }
  }
  if (sum.x === 0 && sum.z === 0) return undefined;
  return normalize(sum);
}

// Map a frame coordinate [x, z] to world space: x along right (north rotated -90°), z along north.
function frameToWorld(spot: Vec2, north: Vec2): Vec2 {
  const right: Vec2 = { x: north.z, z: -north.x };
  return {
    x: spot.x * right.x + spot.z * north.x,
    z: spot.x * right.z + spot.z * north.z,
  };
}

// Generic, data-driven bot solver: iterate world.botSolvers.generic in order; the first rule whose
// conditions all match and that yields a spot for this bot wins. Returns undefined when no rule
// applies, letting the caller fall back to authored waypoints.
export function genericSolverWaypoint(player: Player, world: World): Vec2 | undefined {
  const rules = world.botSolvers?.generic;
  if (!rules?.length) return undefined;

  const mechanics = resolvedMechanics(world);
  for (const rule of rules) {
    const matched = ruleMatches(rule, player, world, mechanics);
    if (matched === null) continue;
    const spot = rule.spots?.[player.id] ?? rule.spot;
    if (!spot) continue;
    if (rule.frame === undefined) return spot;
    const north = frameNorth(rule.frame, matched, world);
    if (!north) continue; // frame uncomputable: fall through to the next rule
    return frameToWorld(spot, north);
  }
  return undefined;
}
