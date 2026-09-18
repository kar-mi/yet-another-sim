import type { Crystal, World } from "@shared/types";
import { nextRandom, randomInt } from "@shared/rng";
import { selectOrbLayout } from "./blackHoleOrbs";
import { placeCrystals } from "./crystals";
import { toVec2 } from "./eventTransforms";
import type { RaidDef } from "./raidSchema";

export type PreRollDecisions = Record<string, number>;
export type RngConstraints = Readonly<Record<string, number>>;

function selected(key: string, rolled: number, constraints: RngConstraints, decisions: PreRollDecisions): number {
  const value = constraints[key] ?? rolled;
  decisions[key] = value;
  return value;
}

// Cardinal direction constants -> [x, z] vectors. +z = north, +x = east.
const DIRECTION_VECTORS: Record<"up" | "down" | "left" | "right", [number, number]> = {
  up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0],
};

// Assign each player a plant combination from optionals.combinations.plant. Each group lists its
// members explicitly; their selected combo pool is shuffled so members draw different combos when
// possible. `rng: true` flips a seeded coin to swap which group's combo pool each group draws from.
function buildPlantPlan(
  raid: RaidDef,
  rngState: number,
  decisions: PreRollDecisions,
  constraints: RngConstraints,
): { plan: Record<string, [number, number][]>; rngState: number } {
  const plant = raid.optionals?.combinations?.plant;
  if (!plant) return { plan: {}, rngState };

  let swap = false;
  let nextState = rngState;
  if (plant.rng) {
    const roll = nextRandom(rngState);
    swap = selected("plant-swap", roll.value < 0.5 ? 1 : 0, constraints, decisions) === 1;
    nextState = roll.state;
  }

  const plan: Record<string, [number, number][]> = {};
  const assign = (members: string[], combos: ("up" | "down" | "left" | "right")[][]) => {
    const comboOrder = combos.map((_, i) => i);
    for (let i = comboOrder.length - 1; i > 0; i--) {
      const roll = randomInt(nextState, i + 1);
      nextState = roll.state;
      [comboOrder[i], comboOrder[roll.value]] = [comboOrder[roll.value], comboOrder[i]];
    }
    members.forEach((id, i) => {
      plan[id] = combos[comboOrder[i % comboOrder.length]].map(d => DIRECTION_VECTORS[d]);
    });
  };
  assign(plant.g1.members, swap ? plant.g2.combos : plant.g1.combos);
  assign(plant.g2.members, swap ? plant.g1.combos : plant.g2.combos);
  return { plan, rngState: nextState };
}

// Seeded per-run rotation of tower-wave positions around their canonical ring: each wave (towers
// sharing a `t`, named `-left`/`-right`) is remapped to a different canonical position-pair by a
// random start offset + direction. Off unless `towerRng`.
function rotateTowerWaves(
  events: RaidDef["events"],
  towerRng: boolean | undefined,
  rngState: number,
  decisions: PreRollDecisions,
  constraints: RngConstraints,
): { events: RaidDef["events"]; rngState: number } {
  if (!towerRng) return { events, rngState };

  const roll1 = randomInt(rngState, 8);
  const startOffset = selected("towers-offset", roll1.value, constraints, decisions);
  const roll2 = randomInt(roll1.state, 2);
  const directionChoice = selected("towers-direction", roll2.value, constraints, decisions);
  const direction = directionChoice === 0 ? 1 : -1;
  const nextState = roll2.state;

  const towerEvents = events.filter((e): e is Extract<RaidDef["events"][number], { type: "tower" }> => e.type === "tower");
  const sortedTimes = [...new Set(towerEvents.map(e => e.t))].sort((a, b) => a - b);

  const canonicalPairs = sortedTimes.map(t => {
    const group = towerEvents.filter(e => e.t === t);
    return {
      left: group.find(e => e.id.endsWith("-left"))!.pos,
      right: group.find(e => e.id.endsWith("-right"))!.pos,
    };
  });

  const result = events.map(e => {
    if (e.type !== "tower") return e;
    const waveIdx = sortedTimes.indexOf(e.t);
    const canonIdx = ((startOffset + direction * waveIdx) % 8 + 8) % 8;
    const side = e.id.endsWith("-left") ? "left" : "right";
    return { ...e, pos: canonicalPairs[canonIdx]![side] };
  });

  return { events: result as RaidDef["events"], rngState: nextState };
}

function applyOrderSwap(
  events: RaidDef["events"],
  orderSwap: NonNullable<RaidDef["optionals"]>["orderSwap"] | undefined,
  rngState: number,
  decisions: PreRollDecisions,
  constraints: RngConstraints,
): { events: RaidDef["events"]; rngState: number } {
  if (!orderSwap?.rng) return { events, rngState };

  const roll = nextRandom(rngState);
  const swap = selected("order-swap", roll.value < 0.5 ? 1 : 0, constraints, decisions);
  if (swap === 0) return { events, rngState: roll.state };

  const [groupA, groupB] = orderSwap.groups;
  const idsA = new Set(groupA);
  const idsB = new Set(groupB);
  const swapA = new Map(groupA.map((id, i) => [id, groupB[i]]));
  const swapB = new Map(groupB.map((id, i) => [id, groupA[i]]));
  const byId = new Map(events.map(e => [e.id, e]));
  const eventA = events.find(e => e.id === groupA[0] && "telegraph" in e);
  const eventB = events.find(e => e.id === groupB[0] && "telegraph" in e);
  if (!eventA || !eventB || !("telegraph" in eventA) || !("telegraph" in eventB)) {
    return { events, rngState: roll.state };
  }

  const result = events.map(e => {
    const paired = byId.get(swapA.get(e.id) ?? swapB.get(e.id) ?? "");
    const showCastBar = paired && "showCastBar" in paired ? { showCastBar: paired.showCastBar } : {};
    if (idsA.has(e.id) && "telegraph" in e) return { ...e, t: eventB.t, telegraph: eventB.telegraph, ...showCastBar };
    if (idsB.has(e.id) && "telegraph" in e) return { ...e, t: eventA.t, telegraph: eventA.telegraph, ...showCastBar };
    return e;
  });
  return { events: result as RaidDef["events"], rngState: roll.state };
}

// Seeded per-run permutation of cast times across groups of events: each entry collects its groups'
// authored (t, telegraph) slots and deals them back out shuffled, so an authored wave order becomes a
// random one while the events themselves stay put. Groups at the same index across entries are
// assumed to describe the same thing, which is what `noRepeatAfter` compares.
function shuffleEventTimes(
  events: RaidDef["events"],
  timeShuffle: NonNullable<RaidDef["optionals"]>["timeShuffle"] | undefined,
  rngState: number,
  decisions: PreRollDecisions,
  constraints: RngConstraints,
): { events: RaidDef["events"]; rngState: number } {
  if (!timeShuffle) return { events, rngState };

  let nextState = rngState;
  const byId = new Map(events.map(e => [e.id, e]));
  const timingById = new Map<string, { t: number; telegraph: number }>();
  const lastGroupOf: Record<string, number> = {};

  for (const entry of timeShuffle) {
    const slots = entry.groups.map(group => {
      const head = byId.get(group[0]!);
      if (!head || !("telegraph" in head)) throw new Error(`timeShuffle "${entry.id}" group head "${group[0]}" has no telegraph`);
      return { t: head.t, telegraph: head.telegraph };
    });

    const order = entry.groups.map((_, i) => i);
    if (entry.rng) {
      // The first slot is drawn from the allowed groups directly rather than by rejection, so the
      // number of rolls never depends on the outcome and a pinned decision replays identically.
      const forbiddenFirst = entry.noRepeatAfter === undefined ? -1 : lastGroupOf[entry.noRepeatAfter] ?? -1;
      const allowed = order.filter(i => i !== forbiddenFirst);
      const firstRoll = randomInt(nextState, allowed.length);
      const first = allowed[selected(`time-shuffle-${entry.id}-first`, firstRoll.value, constraints, decisions)]!;
      nextState = firstRoll.state;

      const rest = order.filter(i => i !== first);
      for (let i = rest.length - 1; i > 0; i--) {
        const roll = randomInt(nextState, i + 1);
        const j = selected(`time-shuffle-${entry.id}-${i}`, roll.value, constraints, decisions);
        [rest[i], rest[j]] = [rest[j]!, rest[i]!];
        nextState = roll.state;
      }
      order[first] = 0;
      rest.forEach((groupIndex, slot) => { order[groupIndex] = slot + 1; });
    }

    entry.groups.forEach((group, groupIndex) => {
      for (const id of group) timingById.set(id, slots[order[groupIndex]!]!);
    });
    lastGroupOf[entry.id] = order.indexOf(slots.length - 1);
  }

  const result = events.map(e => {
    const timing = timingById.get(e.id);
    return timing && "telegraph" in e ? { ...e, t: timing.t, telegraph: timing.telegraph } : e;
  });
  return { events: result as RaidDef["events"], rngState: nextState };
}

// Seeded per-run rotation of a divebomb sweep around its canonical ring: each numbered dash (its
// index in `divebombSweep.events`) is remapped to a different canonical from/to pair by a random
// start offset + direction. When `limitCut` is set, that limit cut's placement basis is derived
// from the rolled sweep (relative-north = opposite dash #1's start; handedness = sweep direction),
// so it never drifts out of sync with the dashes. Off (identity = canonical order) unless `rng`.
function rotateDivebombSweep(
  events: RaidDef["events"],
  divebombSweep: NonNullable<RaidDef["optionals"]>["divebombSweep"] | undefined,
  rngState: number,
  decisions: PreRollDecisions,
  constraints: RngConstraints,
): { events: RaidDef["events"]; rngState: number } {
  if (!divebombSweep) return { events, rngState };

  const order = divebombSweep.events;
  const n = order.length;
  const byId = new Map(events.map(e => [e.id, e]));
  const canonicalPairs = order.map(id => {
    const ev = byId.get(id);
    if (!ev || ev.type !== "divebomb") throw new Error(`divebombSweep.events references non-divebomb id "${id}"`);
    return { from: ev.from, to: ev.to };
  });

  let startOffset = 0;
  let direction = 1;
  let nextState = rngState;
  if (divebombSweep.rng) {
    const roll1 = randomInt(rngState, n);
    startOffset = selected("divebomb-start", roll1.value, constraints, decisions);
    const roll2 = randomInt(roll1.state, 2);
    const directionChoice = selected("divebomb-direction", roll2.value, constraints, decisions);
    direction = directionChoice === 0 ? 1 : -1;
    nextState = roll2.state;
  }

  const slotForDash = new Map(order.map((id, k) => [id, ((startOffset + direction * k) % n + n) % n]));

  const result = events.map(e => {
    if (e.type === "divebomb") {
      const slot = slotForDash.get(e.id);
      if (slot === undefined) return e;
      const pair = canonicalPairs[slot]!;
      return { ...e, from: pair.from, to: pair.to };
    }
    if (e.type === "limit_cut" && e.id === divebombSweep.limitCut) {
      return { ...e, rotation: { kefkaStart: canonicalPairs[startOffset]!.from, kefkaClockwise: direction === -1 } };
    }
    return e;
  });
  return { events: result as RaidDef["events"], rngState: nextState };
}

type EndingCombination = NonNullable<NonNullable<RaidDef["optionals"]>["combinations"]>["endings"];

// Shuffle once, then fill forced slots without assigning the same variant twice.
// Labels and directional endings share the same per-slot override semantics.
function rollVariantOrder(
  count: number,
  rngState: number,
  keyForSlot: (slot: number) => string,
  decisions: PreRollDecisions,
  constraints: RngConstraints,
): { order: number[]; rngState: number } {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const roll = randomInt(rngState, i + 1);
    rngState = roll.state;
    [order[i], order[roll.value]] = [order[roll.value]!, order[i]!];
  }
  const forced = new Set(order.map((_, slot) => constraints[keyForSlot(slot)]).filter(value => value !== undefined));
  const remaining = order.filter(index => !forced.has(index));
  const arranged = order.map((_, slot) => {
    const value = constraints[keyForSlot(slot)] ?? remaining.shift()!;
    decisions[keyForSlot(slot)] = value;
    return value;
  });
  return { order: arranged, rngState };
}

// Seeded assignment of {name, color} variants to slots of event ids: the variants are shuffled and
// dealt one per slot, so which mechanic identity lands on which group of events changes per run.
type LabelVariant = NonNullable<NonNullable<RaidDef["optionals"]>["combinations"]>["labels"] extends
  Record<string, { variants: (infer V)[] }> | undefined ? V : never;

function buildLabelPlan(
  labels: NonNullable<NonNullable<RaidDef["optionals"]>["combinations"]>["labels"],
  rngState: number,
  decisions: PreRollDecisions,
  constraints: RngConstraints,
): { labels: Record<string, LabelVariant>; rngState: number } {
  const plan: Record<string, LabelVariant> = {};
  if (!labels) return { labels: plan, rngState };

  let nextState = rngState;
  for (const [key, spec] of Object.entries(labels)) {
    const { order, rngState: afterLabels } = spec.rng
      ? rollVariantOrder(spec.variants.length, nextState, slot => `label-${key}-${slot}`, decisions, constraints)
      : { order: spec.variants.map((_, i) => i), rngState: nextState };
    nextState = afterLabels;
    spec.slots.forEach((slot, slotIndex) => {
      const variant = spec.variants[order[slotIndex]!]!;
      for (const id of slot) plan[id] = variant;
    });
  }

  return { labels: plan, rngState: nextState };
}

function buildEndingPlan(
  endings: EndingCombination,
  rngState: number,
  decisions: PreRollDecisions,
  constraints: RngConstraints,
): { endingOffsets: Record<string, number>; endingNames: Record<string, string>; rngState: number } {
  if (!endings) return { endingOffsets: {}, endingNames: {}, rngState };

  const { order, rngState: nextState } = endings.rng
    ? rollVariantOrder(endings.variants.length, rngState, slot => `ending-${slot}`, decisions, constraints)
    : { order: endings.variants.map((_, i) => i), rngState };

  const endingOffsets: Record<string, number> = {};
  const endingNames: Record<string, string> = {};
  endings.events.forEach((slot, i) => {
    const variant = endings.variants[order[i]!]!;
    // A slot is one event (forsaken) or a group sharing a variant (e.g. an implosion's cone pair).
    // A variant offset is one angle for all events in the slot, or one angle per event.
    const ids = Array.isArray(slot) ? slot : [slot];
    ids.forEach((id, j) => {
      endingOffsets[id] = Array.isArray(variant.offset) ? variant.offset[j]! : variant.offset;
      if (variant.name !== undefined) endingNames[id] = variant.name;
    });
  });
  return { endingOffsets, endingNames, rngState: nextState };
}

type EventSets = NonNullable<NonNullable<RaidDef["optionals"]>["combinations"]>["eventSets"];

function applyEventSets(
  events: RaidDef["events"],
  eventSets: EventSets,
  rngState: number,
  decisions: PreRollDecisions,
  constraints: RngConstraints,
): { events: RaidDef["events"]; rngState: number } {
  if (!eventSets) return { events, rngState };

  let nextState = rngState;
  const keep = new Set<string>();
  const drop = new Set<string>();
  for (const [key, setConfig] of Object.entries(eventSets)) {
    let selectedIndex = 0;
    if (setConfig.rng && setConfig.sets.length > 1) {
      const roll = randomInt(nextState, setConfig.sets.length);
      selectedIndex = selected(`event-set-${key}`, roll.value, constraints, decisions);
      nextState = roll.state;
    }
    setConfig.sets.forEach((set, i) => {
      for (const id of set) (i === selectedIndex ? keep : drop).add(id);
    });
  }

  return {
    events: events.filter(e => keep.has(e.id) || !drop.has(e.id)) as RaidDef["events"],
    rngState: nextState,
  };
}

function applyBlackHoleSpots(
  events: RaidDef["events"],
  rngState: number,
  decisions: PreRollDecisions,
  constraints: RngConstraints,
): { events: RaidDef["events"]; rngState: number; blackHoleTethers: World["blackHoleTethers"] } {
  let nextState = rngState;
  const blackHoleTethers: World["blackHoleTethers"] = {};
  const result = events.map(e => {
    if (e.type !== "hazard" || !e.blackHole) return e;
    const combos = e.blackHole.combos.map(combo =>
      combo.map(orb => ({ pos: toVec2(orb.pos), tether: orb.tether })),
    );
    const comboKey = `black-hole-${e.id}-combo`;
    const rotationKey = `black-hole-${e.id}-rotation`;
    const layout = selectOrbLayout(combos, nextState, constraints[comboKey], constraints[rotationKey]);
    decisions[`black-hole-${e.id}-combo`] = layout.combo;
    decisions[`black-hole-${e.id}-rotation`] = layout.rotation;
    nextState = layout.rngState;
    blackHoleTethers[e.id] = {
      positions: layout.orbs.filter(orb => orb.tether).map(orb => orb.pos),
      orderFrom: e.blackHole.orderFrom,
    };
    return { ...e, spots: layout.orbs.map(orb => [orb.pos.x, orb.pos.z] as [number, number]) };
  });
  return { events: result as RaidDef["events"], rngState: nextState, blackHoleTethers };
}

// Select a pairing pattern (seeded when `rng`) and derive the generic maps any mechanic can consume:
// partners (paired player), playerGroups (each pair's declared group label), and initialCharges
// (each member's declared charge kind — the opener deal of the `reassign` event).
function buildPairingPlan(
  raid: RaidDef,
  rngState: number,
  decisions: PreRollDecisions,
  constraints: RngConstraints,
): { partners: Record<string, string>; playerGroups: Record<string, string>; initialCharges: Record<string, string>; rngState: number } {
  const pairings = raid.optionals?.combinations?.pairings;
  if (!pairings) return { partners: {}, playerGroups: {}, initialCharges: {}, rngState };

  let nextState = rngState;
  let patternIndex = 0;
  if (pairings.rng && pairings.patterns.length > 1) {
    const roll = randomInt(nextState, pairings.patterns.length);
    nextState = roll.state;
    patternIndex = selected("pairings", roll.value, constraints, decisions);
  }

  const pattern = pairings.patterns[patternIndex] ?? pairings.patterns[0]!;
  const partners: Record<string, string> = {};
  const playerGroups: Record<string, string> = {};
  const initialCharges: Record<string, string> = {};
  for (const pair of pattern.pairs) {
    const [a, b] = pair.members;
    partners[a] = b;
    partners[b] = a;
    if (pair.group) {
      playerGroups[a] = pair.group;
      playerGroups[b] = pair.group;
    }
    if (pair.charges) {
      initialCharges[a] = pair.charges[0];
      initialCharges[b] = pair.charges[1];
    }
  }

  return { partners, playerGroups, initialCharges, rngState: nextState };
}

function applyHeadSequence(
  events: RaidDef["events"],
  sequence: NonNullable<RaidDef["optionals"]>["headSequence"],
  rngState: number,
  decisions: PreRollDecisions,
  constraints: RngConstraints,
): { events: RaidDef["events"]; rngState: number } {
  if (!sequence) return { events, rngState };
  const choose = (key: string, count: number) => {
    if (!sequence.rng) return 0;
    const roll = randomInt(rngState, count);
    rngState = roll.state;
    return selected(`head-sequence-${key}`, roll.value, constraints, decisions);
  };
  const first = choose("first", 2);
  const groups = [sequence.cardinals, sequence.intercards];
  const spots = [0, 1].flatMap(group => {
    const ring = groups[(first + group) % 2];
    const start = choose(`group-${group + 1}-start`, 4);
    const direction = choose(`group-${group + 1}-direction`, 2) === 0 ? 1 : -1;
    return Array.from({ length: 4 }, (_, i) => ring[(start + direction * i + 4) % 4]);
  });
  return {
    events: events.map(event => {
      if (event.type !== "teleport_boss") return event;
      const index = sequence.events.indexOf(event.id);
      if (index < 0) return event;
      return { ...event, spots: [spots[index]], rng: false };
    }),
    rngState,
  };
}

export function preRollRaid(raid: RaidDef, seed: number, constraints: RngConstraints = {}): {
  events: RaidDef["events"];
  plantPlan: Record<string, [number, number][]>;
  partners: Record<string, string>;
  playerGroups: Record<string, string>;
  initialCharges: Record<string, string>;
  crystals: Crystal[];
  endingOffsets: Record<string, number>;
  blackHoleTethers: World["blackHoleTethers"];
  decisions: PreRollDecisions;
  rngState: number;
} {
  const decisions: PreRollDecisions = {};
  const { plan: plantPlan, rngState: afterPlantRngState } = buildPlantPlan(raid, seed, decisions, constraints);
  // Generic pairing/grouping maps: partners/playerGroups for the bot solver, initialCharges for the
  // reassign opener.
  const { partners, playerGroups, initialCharges, rngState: afterPairingRngState } = buildPairingPlan(raid, afterPlantRngState, decisions, constraints);
  const { crystals, rolls: crystalRolls, rngState: afterCrystalRngState } = placeCrystals(raid.crystals, afterPairingRngState, constraints);
  crystalRolls.forEach((roll, i) => {
    decisions[`crystals-${i}-empty`] = roll.emptyIndex;
    decisions[`crystals-${i}-swap`] = roll.swap;
  });
  const { events: rotatedEvents, rngState: afterTowerRngState } = rotateTowerWaves(raid.events, raid.optionals?.towerRng, afterCrystalRngState, decisions, constraints);
  const { labels, rngState: afterLabelRngState } = buildLabelPlan(raid.optionals?.combinations?.labels, afterTowerRngState, decisions, constraints);
  const { endingOffsets, endingNames, rngState: afterEndingRngState } = buildEndingPlan(raid.optionals?.combinations?.endings, afterLabelRngState, decisions, constraints);
  const { events: swappedEvents, rngState: afterOrderSwapRngState } = applyOrderSwap(rotatedEvents, raid.optionals?.orderSwap, afterEndingRngState, decisions, constraints);
  const { events: shuffledEvents, rngState: afterTimeShuffleRngState } = shuffleEventTimes(swappedEvents, raid.optionals?.timeShuffle, afterOrderSwapRngState, decisions, constraints);
  const { events: sweptEvents, rngState: afterDivebombSweepRngState } = rotateDivebombSweep(shuffledEvents, raid.optionals?.divebombSweep, afterTimeShuffleRngState, decisions, constraints);
  const { events: selectedEvents, rngState: afterEventSetRngState } = applyEventSets(sweptEvents, raid.optionals?.combinations?.eventSets, afterDivebombSweepRngState, decisions, constraints);
  const { events: hazardEvents, rngState: afterBlackHoleRngState, blackHoleTethers } = applyBlackHoleSpots(selectedEvents, afterEventSetRngState, decisions, constraints);
  const { events: headEvents, rngState } = applyHeadSequence(hazardEvents, raid.optionals?.headSequence, afterBlackHoleRngState, decisions, constraints);
  const events = headEvents.map(e => {
    const label = labels[e.id];
    const labelled = label === undefined ? e : {
      ...e,
      name: label.name,
      ...(label.color !== undefined ? { color: label.color } : {}),
      ...(label.glyph !== undefined && e.type === "aoe" && e.glyph ? { glyph: { ...e.glyph, kind: label.glyph } } : {}),
    };
    return endingOffsets[e.id] === undefined
      ? labelled
      : { ...labelled, directionOffset: endingOffsets[e.id], ...(endingNames[e.id] !== undefined ? { name: endingNames[e.id] } : {}) };
  }) as RaidDef["events"];

  return {
    events,
    plantPlan,
    partners,
    playerGroups,
    initialCharges,
    crystals,
    endingOffsets,
    blackHoleTethers,
    decisions,
    rngState,
  };
}
