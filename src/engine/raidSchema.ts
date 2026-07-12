import { z } from "zod";
import { ROSTER, RaidIdSchema } from "@shared/protocol";
import { BOSS_REGISTRY, BOSS_REGISTRY_IDS, DEFAULT_BOSS_ID, isBossRegistryId, type BossRegistryId } from "./bossRegistry";
import { BotSolversSchema } from "./raidSchemaBotSolvers";
import { CrystalsSchema, FloorPlanSchema, WaymarkSchema, ZoneShapeSchema } from "./raidSchemaFoundation";
import { EventSchema } from "./raidSchemaEvents";
import { EventIdSchema, RoleSchema, Vec2Schema, WaypointSchema } from "./raidSchemaPrimitives";

const PlayerDefSchema = z.object({
  id: z.string().min(1),
  role: RoleSchema,
  spawn: Vec2Schema,
  pattern: z.array(WaypointSchema).optional(),
});

// Cardinal direction constants (more readable than [x, z] vectors). +z = north, +x = east.
const DirectionConstSchema = z.enum(["up", "down", "left", "right"]);
// A plant combination is one cardinal direction per plant slot (e.g. [short, long]).
const PlantComboSchema = z.array(DirectionConstSchema).min(1);
// A plant group: an explicit list of player ids plus the combo pool its members draw from.
// The combo pool is shuffled per seed before assignment, wrapping if there are fewer combos than members.
const PlantGroupSchema = z.object({
  members: z.array(z.string().min(1)).min(1),
  combos: z.array(PlantComboSchema).min(1),
});
// A pairing pair: two player ids, an optional group label (for bot-solver when.soaks) and optional
// per-member initial charge kinds (for a reassign event's `initial: "plan"` opener).
const PairingPairSchema = z.object({
  members: z.tuple([z.string().min(1), z.string().min(1)]),
  group: z.string().min(1).optional(),
  charges: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
});
const PairingPatternSchema = z.object({
  id: z.string().min(1).optional(),
  pairs: z.array(PairingPairSchema).min(1),
});
// Optional per-mechanic combinations. `plant` declares two groups (g1/g2) of members + combos.
// `pairings` declares patterns of player pairs (one selected per run when `rng`), each carrying an
// optional group label + initial charges that feed world.partners / playerGroups / initialCharges.
const OptionalsSchema = z.object({
  rngLabels: z.record(z.string().min(1), z.object({
    label: z.string().min(1).optional(),
    options: z.array(z.string().min(1)).optional(),
  })).optional(),
  // Seeded per-run rotation of tower-wave positions around their canonical ring (see rotateTowerWaves).
  towerRng: z.boolean().default(false),
  orderSwap: z.object({
    rng: z.boolean().default(false),
    groups: z.array(z.array(EventIdSchema).min(1)).length(2),
  }).optional(),
  // Seeded per-run rotation of a divebomb sweep around its canonical ring (see rotateDivebombSweep).
  // `events` lists the divebomb ids in canonical sweep order (the list index is each dash's number).
  // `limitCut` (optional) names a limit cut whose placement basis is derived from the rolled sweep.
  divebombSweep: z.object({
    rng: z.boolean().default(false),
    events: z.array(EventIdSchema).min(2),
    limitCut: EventIdSchema.optional(),
  }).optional(),
  combinations: z.object({
    plant: z.object({
      rng: z.boolean().default(false),
      debuffOrder: z.array(z.number().int().nonnegative()).optional(),
      g1: PlantGroupSchema,
      g2: PlantGroupSchema,
    }).optional(),
    pairings: z.object({
      rng: z.boolean().default(false),
      patterns: z.array(PairingPatternSchema).min(1),
    }).optional(),
    endings: z.object({
      rng: z.boolean().default(false),
      // Each entry is one slot: a single event id, or a group of ids that share one variant
      // (e.g. a pair of opposing implosion cones). Variants shuffle across the slots per seed.
      events: z.array(z.union([EventIdSchema, z.array(EventIdSchema).min(1)])).min(1),
      // `offset` is a single angle, or one angle per event when the slot is a group.
      variants: z.array(z.object({
        offset: z.union([z.number(), z.array(z.number())]),
        name: z.string().min(1).optional(),
      })).min(1),
    }).optional(),
    eventSets: z.record(z.string().min(1), z.object({
      rng: z.boolean().default(false),
      sets: z.array(z.array(EventIdSchema).min(1)).min(1),
    })).optional(),
  }).optional(),
}).optional();

// Exhaustive list of glb stems available under /static/model/. Add new boss models here.
export const BOSS_MODEL_NAMES = ["kefka", "chaos", "exdeath"] as const;
export type BossModelName = (typeof BOSS_MODEL_NAMES)[number];
const BossModelSchema = z.enum(BOSS_MODEL_NAMES);

const BossSchema = z.strictObject({
  id: z.enum(BOSS_REGISTRY_IDS).optional(),
  pos: Vec2Schema.default([0, 0]),
  radius: z.number().positive().optional(),
  ring: z.object({
    scale: z.number().positive().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }).optional(),
  model: BossModelSchema.optional(),
}).default({ pos: [0, 0] });

// Boss entry in a multi-boss `bosses:` list. Same fields as BossSchema plus a required id slug
// and an optional aggro seed (player id whose threat is pre-seeded to the top so this boss
// faces a specific tank from the start).
const BossWithIdSchema = z.strictObject({
  id: RaidIdSchema,
  pos: Vec2Schema.default([0, 0]),
  radius: z.number().positive().optional(),
  ring: z.object({
    scale: z.number().positive().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }).optional(),
  model: BossModelSchema.optional(),
  aggro: z.string().min(1).optional(),
  targetable: z.boolean().default(true),
  hidden: z.boolean().default(false),  // start with the model not drawn (a divebomb teleportBoss can reveal it)
  sink: z.number().min(0).max(1).default(0),  // fraction of model body height sunk below the ground (e.g. boss positioned under the map)
});

type BossIdentityOverrides = {
  model?: BossModelName;
  radius?: number;
  ring?: { scale?: number; color?: string };
};

function resolveBossIdentity(overrides: BossIdentityOverrides, registryId: BossRegistryId) {
  const preset = BOSS_REGISTRY[registryId];
  return {
    model: overrides.model ?? preset.model,
    modelScale: preset.modelScale,
    radius: overrides.radius ?? preset.radius,
    ring: {
      scale: overrides.ring?.scale ?? preset.ring.scale,
      color: overrides.ring?.color ?? preset.ring.color,
    },
  };
}

export const RaidSchema = z.object({
  name: z.string().min(1),
  arena: z.object({ zones: z.array(ZoneShapeSchema).min(1), floorPlan: FloorPlanSchema }),
  duration: z.number().positive(),
  boss: BossSchema,
  // Multi-boss: when present, takes precedence over `boss`. Each entry requires a unique id slug.
  bosses: z.array(BossWithIdSchema).min(1).optional(),
  botPatterns: RaidIdSchema.optional(),
  // Named alternate bot-pattern files the host can pick between (Options modal "Bots" tab).
  // Additive: raids with only `botPatterns` show a single implicit "Default" option.
  botPatternOptions: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    file: RaidIdSchema,
  })).min(1).optional(),
  players: z.array(PlayerDefSchema).length(ROSTER.length),
  events: z.array(EventSchema),
  waymarks: z.array(WaymarkSchema).optional(),
  crystals: CrystalsSchema,
  optionals: OptionalsSchema,
  botSolvers: BotSolversSchema,
}).superRefine((raid, ctx) => {
  // Validate that boss ids in the bosses list are unique.
  if (raid.bosses) {
    const seenBossIds = new Set<string>();
    raid.bosses.forEach((boss, i) => {
      if (seenBossIds.has(boss.id)) {
        ctx.addIssue({ code: "custom", path: ["bosses", i, "id"], message: `duplicate boss id "${boss.id}"` });
      }
      seenBossIds.add(boss.id);
    });
  }
  // Compute the effective set of boss ids for bossId validation.
  const bossIds = raid.bosses ? new Set(raid.bosses.map(b => b.id)) : new Set(["boss"]);
  // Validate that every event bossId references a declared boss.
  raid.events.forEach((event, i) => {
    const bossId = (event as { bossId?: string }).bossId;
    if (bossId !== undefined && !bossIds.has(bossId)) {
      ctx.addIssue({
        code: "custom",
        path: ["events", i, "bossId"],
        message: `event bossId "${bossId}" does not match any declared boss id (${[...bossIds].join(", ")})`,
      });
    }
  });
  raid.botSolvers?.generic?.forEach((rule, i) => {
    if (rule.origin?.boss !== undefined && !bossIds.has(rule.origin.boss)) {
      ctx.addIssue({
        code: "custom",
        path: ["botSolvers", "generic", i, "origin", "boss"],
        message: `solver origin boss id "${rule.origin.boss}" does not match any declared boss id (${[...bossIds].join(", ")})`,
      });
    }
    if (rule.nearestEdge !== undefined) {
      for (const [key, ref] of [["from", rule.nearestEdge.from], ["avoid", rule.nearestEdge.avoid]] as const) {
        const bossId = typeof ref === "object" && "boss" in ref ? ref.boss.id : undefined;
        if (bossId !== undefined && !bossIds.has(bossId)) {
          ctx.addIssue({
            code: "custom",
            path: ["botSolvers", "generic", i, "nearestEdge", key, "boss", "id"],
            message: `solver nearestEdge boss id "${bossId}" does not match any declared boss id (${[...bossIds].join(", ")})`,
          });
        }
      }
    }
    if (!Array.isArray(rule.frame)) return;
    rule.frame.forEach((ref, j) => {
      const bossId = typeof ref === "object" && "boss" in ref ? ref.boss.id : undefined;
      if (bossId !== undefined && !bossIds.has(bossId)) {
        ctx.addIssue({
          code: "custom",
          path: ["botSolvers", "generic", i, "frame", j, "boss", "id"],
          message: `solver frame boss id "${bossId}" does not match any declared boss id (${[...bossIds].join(", ")})`,
        });
      }
    });
  });
}).superRefine((raid, ctx) => {
  const eventIds = new Map<string, { type: string; index: number }>();
  raid.events.forEach((event, i) => {
    const prior = eventIds.get(event.id);
    if (prior) {
      ctx.addIssue({
        code: "custom",
        path: ["events", i, "id"],
        message: `duplicate event id "${event.id}" also used by ${prior.type} at events[${prior.index}]`,
      });
      return;
    }
    eventIds.set(event.id, { type: event.type, index: i });
  });

  raid.optionals?.orderSwap?.groups.forEach((group, groupIndex) => {
    let timing: { t: number; telegraph: number } | undefined;
    group.forEach((id, idIndex) => {
      const event = raid.events.find(e => e.id === id);
      if (!event) {
        ctx.addIssue({
          code: "custom",
          path: ["optionals", "orderSwap", "groups", groupIndex, idIndex],
          message: `orderSwap references unknown event id "${id}"`,
        });
        return;
      }
      if (!("telegraph" in event)) {
        ctx.addIssue({
          code: "custom",
          path: ["optionals", "orderSwap", "groups", groupIndex, idIndex],
          message: `orderSwap event "${id}" must have a telegraph`,
        });
        return;
      }
      const current = { t: event.t, telegraph: event.telegraph };
      if (timing === undefined) {
        timing = current;
      } else if (timing.t !== current.t || timing.telegraph !== current.telegraph) {
        ctx.addIssue({
          code: "custom",
          path: ["optionals", "orderSwap", "groups", groupIndex, idIndex],
          message: `orderSwap group ${groupIndex} events must share the same time and telegraph`,
        });
      }
    });
  });

  raid.events.forEach((event, i) => {
    if (event.type !== "tower") return;
    event.resolveEventIds?.forEach((id, j) => {
      const target = eventIds.get(id);
      if (!target) {
        ctx.addIssue({
          code: "custom",
          path: ["events", i, "resolveEventIds", j],
          message: `tower resolveEventIds references unknown event id "${id}"`,
        });
      } else if (target.type !== "effect_resolver") {
        ctx.addIssue({
          code: "custom",
          path: ["events", i, "resolveEventIds", j],
          message: `tower resolveEventIds "${id}" must reference an effect_resolver event, not ${target.type}`,
        });
      }
    });
  });

  const seenMarks = new Set<string>();
  raid.waymarks?.forEach((waymark, i) => {
    if (seenMarks.has(waymark.mark)) {
      ctx.addIssue({
        code: "custom",
        path: ["waymarks", i],
        message: `duplicate waymark "${waymark.mark}"; each mark may be placed at most once`,
      });
    }
    seenMarks.add(waymark.mark);
  });

  ROSTER.forEach((expected, i) => {
    const player = raid.players[i];
    if (!player) return; // length() already reported the count mismatch
    if (player.id !== expected.id || player.role !== expected.role) {
      ctx.addIssue({
        code: "custom",
        path: ["players", i],
        message: `player ${i} must be "${expected.id}" (${expected.role}); roster order is ${ROSTER.map(r => `${r.id}:${r.role}`).join(", ")}`,
      });
    }
  });

  const playerIds = new Set(raid.players.map(p => p.id));
  raid.events.forEach((event, i) => {
    if (event.type !== "chain") return;
    event.pairs.forEach((pair, j) => {
      for (const id of pair) {
        if (!playerIds.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["events", i, "pairs", j],
            message: `chain pair references unknown player id "${id}"`,
          });
        }
      }
    });
  });

  raid.events.forEach((event, i) => {
    if (event.type !== "line_link" || !event.target.playerIds) return;
    event.target.playerIds.forEach((id, j) => {
      if (!playerIds.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["events", i, "target", "playerIds", j],
          message: `line_link target references unknown player id "${id}"`,
        });
      }
    });
  });

  const lineLinkEventsById = new Map<string, { t: number; index: number; groupCount: number }>();
  raid.events.forEach((event, i) => {
    if (event.type !== "line_link") return;
    lineLinkEventsById.set(event.id, {
      t: event.t,
      index: i,
      groupCount: event.target.roleGroups?.length ?? 0,
    });
  });
  raid.events.forEach((event, i) => {
    if (event.type !== "line_link" || event.link === undefined) return;
    const source = lineLinkEventsById.get(event.link);
    if (!source) {
      ctx.addIssue({
        code: "custom",
        path: ["events", i, "link"],
        message: `link references unknown line_link id "${event.link}"`,
      });
    } else if (source.t > event.t || (source.t === event.t && source.index >= i)) {
      ctx.addIssue({
        code: "custom",
        path: ["events", i, "link"],
        message: `linked line_link "${event.link}" must occur earlier, or appear earlier when t is the same`,
      });
    }
    if (event.target.roleGroups?.length !== 2 || (source && source.groupCount !== 2)) {
      ctx.addIssue({
        code: "custom",
        path: ["events", i, "link"],
        message: `linked line_link events must both define exactly 2 target.roleGroups so the complement is well-defined`,
      });
    }
  });

  // group events: validate member ids, and that links reference an earlier 2-group event.
  const groupEventsById = new Map<string, { t: number; groupCount: number }>();
  raid.events.forEach(event => {
    if (event.type === "group" || event.type === "effect_select") {
      groupEventsById.set(event.id, { t: event.t, groupCount: event.groups.length });
    }
  });
  raid.events.forEach((event, i) => {
    if (event.type !== "group" && event.type !== "effect_select") return;
    event.groups.forEach((group, g) => {
      group.forEach(id => {
        if (!playerIds.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["events", i, "groups", g],
            message: `${event.type} references unknown player id "${id}"`,
          });
        }
      });
    });
    if (event.link !== undefined) {
      const source = groupEventsById.get(event.link);
      if (!source) {
        ctx.addIssue({
          code: "custom",
          path: ["events", i, "link"],
          message: `link references unknown group event id "${event.link}"`,
        });
      } else if (source.t >= event.t) {
        ctx.addIssue({
          code: "custom",
          path: ["events", i, "link"],
          message: `linked group event "${event.link}" must occur earlier (t < ${event.t})`,
        });
      }
      if (event.groups.length !== 2 || (source && source.groupCount !== 2)) {
        ctx.addIssue({
          code: "custom",
          path: ["events", i, "link"],
          message: `linked group events must have exactly 2 groups so the complement is well-defined`,
        });
      }
    }
  });

  // spread_stack events: every stack-group member id must exist in the roster.
  raid.events.forEach((event, i) => {
    if (event.type !== "spread_stack") return;
    event.stack.groups.forEach((group, g) => {
      group.forEach(id => {
        if (!playerIds.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["events", i, "stack", "groups", g],
            message: `spread_stack references unknown player id "${id}"`,
          });
        }
      });
    });
  });

  // bait/dash events must reference an earlier `aoe` with deferred:true (the stored cleave).
  const deferredAoeById = new Map<string, { t: number; index: number }>();
  raid.events.forEach((event, i) => {
    if (event.type === "aoe" && event.deferred) deferredAoeById.set(event.id, { t: event.t, index: i });
  });
  raid.events.forEach((event, i) => {
    if (event.type !== "bait" && event.type !== "dash") return;
    const source = deferredAoeById.get(event.link);
    if (!source) {
      ctx.addIssue({
        code: "custom",
        path: ["events", i, "link"],
        message: `${event.type} link "${event.link}" must reference an aoe event with deferred:true`,
      });
    } else if (source.t > event.t || (source.t === event.t && source.index >= i)) {
      ctx.addIssue({
        code: "custom",
        path: ["events", i, "link"],
        message: `linked stored cleave "${event.link}" must occur earlier than the ${event.type}`,
      });
    }
  });

  // plant combination groups: every declared member id must exist in the roster.
  const plant = raid.optionals?.combinations?.plant;
  if (plant) {
    (["g1", "g2"] as const).forEach(key => {
      plant[key].members.forEach((id, j) => {
        if (!playerIds.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["optionals", "combinations", "plant", key, "members", j],
            message: `plant ${key} references unknown player id "${id}"`,
          });
        }
      });
    });
  }

  const pairings = raid.optionals?.combinations?.pairings;
  if (pairings) {
    pairings.patterns.forEach((pattern, patternIndex) => {
      const members = new Set<string>();
      pattern.pairs.forEach((pair, pairIndex) => {
        pair.members.forEach((id, memberIndex) => {
          if (!playerIds.has(id)) {
            ctx.addIssue({
              code: "custom",
              path: ["optionals", "combinations", "pairings", "patterns", patternIndex, "pairs", pairIndex, "members", memberIndex],
              message: `pairing pattern references unknown player id "${id}"`,
            });
          }
          if (members.has(id)) {
            ctx.addIssue({
              code: "custom",
              path: ["optionals", "combinations", "pairings", "patterns", patternIndex, "pairs", pairIndex, "members", memberIndex],
              message: `pairing pattern assigns player "${id}" more than once`,
            });
          }
          members.add(id);
        });
      });
    });
  }

  const endings = raid.optionals?.combinations?.endings;
  if (endings) {
    if (endings.variants.length !== endings.events.length) {
      ctx.addIssue({
        code: "custom",
        path: ["optionals", "combinations", "endings", "variants"],
        message: "endings variants length must match events length",
      });
    }
    endings.events.forEach((slot, i) => {
      const ids = Array.isArray(slot) ? slot : [slot];
      ids.forEach((id, j) => {
        if (eventIds.get(id)?.type !== "aoe") {
          ctx.addIssue({
            code: "custom",
            path: Array.isArray(slot)
              ? ["optionals", "combinations", "endings", "events", i, j]
              : ["optionals", "combinations", "endings", "events", i],
            message: `ending event "${id}" must reference an aoe event`,
          });
        }
      });
      const variant = endings.variants[i];
      if (variant && Array.isArray(variant.offset) && variant.offset.length !== ids.length) {
        ctx.addIssue({
          code: "custom",
          path: ["optionals", "combinations", "endings", "variants", i, "offset"],
          message: `endings variant ${i} offset array length must match its event group length`,
        });
      }
    });
  }

  const eventSets = raid.optionals?.combinations?.eventSets;
  if (eventSets) {
    Object.entries(eventSets).forEach(([key, setConfig]) => {
      setConfig.sets.forEach((set, setIndex) => {
        set.forEach((id, idIndex) => {
          if (!eventIds.has(id)) {
            ctx.addIssue({
              code: "custom",
              path: ["optionals", "combinations", "eventSets", key, "sets", setIndex, idIndex],
              message: `event set "${key}" references unknown event id "${id}"`,
            });
          }
        });
      });
    });
  }
}).transform(data => {
  const bosses = data.bosses?.map(({ id, pos, aggro, targetable, hidden, sink, ...overrides }) => ({
    id,
    pos,
    targetable,
    hidden,
    sink,
    ...resolveBossIdentity(overrides, isBossRegistryId(id) ? id : DEFAULT_BOSS_ID),
    ...(aggro !== undefined ? { aggro } : {}),
  })) ?? [{
    id: "boss",
    pos: data.boss.pos,
    targetable: true,
    hidden: false,
    sink: 0,
    ...resolveBossIdentity(data.boss, data.boss.id ?? DEFAULT_BOSS_ID),
  }];

  return {
    ...data,
    bosses,
  };
});

export const BotPatternsSchema = z.object({
  players: z.record(z.string().min(1), z.array(WaypointSchema)),
  solvers: BotSolversSchema,
});

export type RaidDef = z.infer<typeof RaidSchema>;
export type BotPatternsDef = z.infer<typeof BotPatternsSchema>;
