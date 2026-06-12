import type { Vec2 } from "../shared/math";
import type { GenericSolverRule, Player, World } from "../shared/types";

type ResolvedMechanic = { resolvedId: string; telegraphStart: number; resolveAt: number };

// Walk the unresolved active mechanics in the world and yield each one's resolved id (the base
// event id extended with dot-separated RNG-outcome segments) plus its telegraph->resolve window.
// Generic solver rules match these ids by segment prefix, so "lightning-1" matches any outcome.
export function resolvedMechanics(world: World): ResolvedMechanic[] {
  const out: ResolvedMechanic[] = [];

  // Plain (non-RNG) telegraphs: the resolved id is just the event id.
  for (const m of world.active) {
    if (!m.resolved) out.push({ resolvedId: m.id, telegraphStart: m.telegraphStart, resolveAt: m.resolveAt });
  }
  for (const t of world.towers) {
    if (!t.resolved) out.push({ resolvedId: t.id, telegraphStart: t.telegraphStart, resolveAt: t.resolveAt });
  }
  for (const t of world.pendingTowers) {
    out.push({ resolvedId: t.id, telegraphStart: t.t - t.telegraph, resolveAt: t.t });
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

function hasActiveDebuff(player: Player, name: string, time: number): boolean {
  return player.effects.some(effect =>
    effect.name === name && effect.appliedAt <= time && effect.appliedAt + effect.duration > time);
}

function ruleMatches(rule: GenericSolverRule, player: Player, world: World, mechanics: ResolvedMechanic[]): boolean {
  const time = world.time;
  if (rule.startAt !== undefined && time < rule.startAt) return false;
  if (rule.endAt !== undefined && time > rule.endAt) return false;

  const { mechanic, role, debuff } = rule.when;
  if (role !== undefined && player.role !== role) return false;
  if (debuff !== undefined && !hasActiveDebuff(player, debuff, time)) return false;
  if (mechanic !== undefined) {
    const segments = mechanic.split(".");
    const live = mechanics.some(m =>
      m.telegraphStart <= time && time <= m.resolveAt && prefixMatches(segments, m.resolvedId));
    if (!live) return false;
  }
  return true;
}

// Generic, data-driven bot solver: iterate world.botSolvers.generic in order; the first rule whose
// conditions all match and that yields a spot for this bot wins. Returns undefined when no rule
// applies, letting the caller fall back to other solvers / authored waypoints.
export function genericSolverWaypoint(player: Player, world: World): Vec2 | undefined {
  const rules = world.botSolvers?.generic;
  if (!rules?.length) return undefined;

  const mechanics = resolvedMechanics(world);
  for (const rule of rules) {
    if (!ruleMatches(rule, player, world, mechanics)) continue;
    const spot = rule.spots?.[player.id] ?? rule.spot;
    if (spot) return spot;
  }
  return undefined;
}
