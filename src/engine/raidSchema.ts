import { z } from "zod";
import { ROSTER, RaidIdSchema } from "../shared/protocol";

const Vec2Schema = z.tuple([z.number(), z.number()]);
const WaypointSchema = z.object({ t: z.number().nonnegative(), pos: Vec2Schema });
const RoleSchema = z.enum(["tank", "healer", "dps"]);

const WaymarkSchema = z.object({
  mark: z.enum(["A", "B", "C", "D", "1", "2", "3", "4"]),
  pos: Vec2Schema,
});

const ZoneShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circle"), center: Vec2Schema, radius: z.number().positive() }),
  z.object({ kind: z.literal("rect"), center: Vec2Schema, width: z.number().positive(), height: z.number().positive() }),
  z.object({ kind: z.literal("polygon"), vertices: z.array(Vec2Schema).min(3) }),
]);

const AOEShapeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("circle"), center: Vec2Schema, radius: z.number().positive() }),
  z.object({ kind: z.literal("donut"), center: Vec2Schema, inner: z.number().nonnegative(), outer: z.number().positive() }),
  z.object({ kind: z.literal("cone"), origin: Vec2Schema.default([0, 0]), direction: Vec2Schema.default([0, 1]), angleDeg: z.number().positive(), length: z.number().positive() }),
  z.object({ kind: z.literal("rect"), origin: Vec2Schema.default([0, 0]), direction: Vec2Schema.default([0, 1]), width: z.number().positive(), length: z.number().positive() }),
]).superRefine((shape, ctx) => {
  if (shape.kind === "donut" && shape.inner >= shape.outer) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "donut inner must be less than outer" });
  }
  if (shape.kind === "cone" && shape.direction[0] === 0 && shape.direction[1] === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cone direction must be a non-zero vector" });
  }
});

const EffectBehaviorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("vuln"), damageType: z.enum(["physical", "magical"]), multiplier: z.number().positive() }),
  z.object({ kind: z.literal("pyretic"), dps: z.number().nonnegative() }),
  z.object({ kind: z.literal("freeze"), dps: z.number().nonnegative() }),
]);

const ApplyEffectSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["buff", "debuff"]),
  duration: z.number().positive(),
  behavior: EffectBehaviorSchema,
  visibility: z.enum(["visible", "invisible"]).optional(),
});

const KnockbackSchema = z.object({
  distance: z.number().positive(),
  height: z.number().nonnegative().default(0), // 0 = horizontal knockback; >0 = knockup arc
  origin: Vec2Schema.optional(),               // defaults to the AOE shape's center/origin
});

const AOEEventSchema = z.object({
  type: z.literal("aoe").default("aoe"),
  t: z.number().nonnegative(),
  name: z.string().min(1),
  telegraph: z.number().positive(),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  shape: AOEShapeSchema,
  applyEffect: ApplyEffectSchema.optional(),
  knockback: KnockbackSchema.optional(),
  // Facing-relative anchoring for cone/rect: snapshot the boss at cast start.
  anchor: z.literal("boss").optional(),            // origin = boss.pos
  directionFrom: z.literal("bossFacing").optional(), // shape direction = boss.facing
  directionOffset: z.number().optional(),          // rotate the bossFacing direction (radians, clockwise)
  // The boss freezes its facing for the duration of the cast (telegraph), then resumes.
  // Defaults to true; set false to let the boss keep tracking its target mid-cast.
  lockFacing: z.boolean().default(true),
  // Directional gate: only hit players whose bearing from the boss is within this arc.
  // `center` (radians, clockwise from boss facing; 0 = front) and full `width` (radians).
  positional: z.object({
    center: z.number(),
    width: z.number().positive().max(Math.PI * 2),
  }).optional(),
  showCastBar: z.boolean().optional(),
  showTelegraph: z.boolean().optional(),
});

const TargetedEventSchema = z.object({
  type: z.literal("targeted"),
  t: z.number().nonnegative(),
  name: z.string().min(1),
  targetMode: z.enum(["closest", "furthest"]),
  role: RoleSchema.optional(),
  radius: z.number().positive(),
  telegraph: z.number().positive(),
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  applyEffect: ApplyEffectSchema.optional(),
  showCastBar: z.boolean().optional(),
  showTelegraph: z.boolean().optional(),
});

const TetherSourceEventSchema = z.object({
  type: z.literal("tether_source"),
  t: z.number().nonnegative(),
  name: z.string().min(1),
  pos: Vec2Schema,
  finalizeAfter: z.number().positive(),
  tetherKind: z.enum(["buff", "debuff"]),
  buffName: z.string().min(1),
  behavior: EffectBehaviorSchema.default({ kind: "none" }),
  effectDuration: z.number().positive().default(15),
});

const LineLinkTargetSchema = z.object({
  mode: z.enum(["closest", "furthest"]).default("closest"),
  roles: z.array(RoleSchema).min(1).optional(),
  playerIds: z.array(z.string().min(1)).min(1).optional(),
  count: z.number().int().positive().optional(),
}).default({ mode: "closest" });

const LineLinkVisualSchema = z.object({
  kind: z.literal("statue").default("statue"),
  width: z.number().positive().default(2.5),
  height: z.number().positive().default(4),
  depth: z.number().positive().default(1),
});

const LineLinkEventSchema = z.object({
  type: z.literal("line_link"),
  t: z.number().nonnegative(),
  name: z.string().min(1),
  pos: Vec2Schema,
  resolveAfter: z.number().positive(),
  linkDuration: z.number().positive().optional(),
  target: LineLinkTargetSchema,
  hiddenDebuffName: z.string().min(1),
  applyEffect: ApplyEffectSchema.optional(),
  knockback: KnockbackSchema.optional(),
  visual: LineLinkVisualSchema.optional(),
});

const TowerVisualSchema = z.object({
  pillar: z.boolean().optional(),          // static rectangle column in the center
  countCircles: z.boolean().optional(),    // one floor circle per required soaker
  fallingCylinder: z.boolean().optional(), // cylinder descending in time with the cast
  groundStyle: z.enum(["standard", "tank"]).optional(), // standard: yellow inner/red outer; tank: two red
  cylinderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), // falling cylinder color
  cylinderThickness: z.number().positive().optional(), // falling cylinder diameter
});

const TowerEventSchema = z.object({
  type: z.literal("tower"),
  t: z.number().nonnegative(),
  name: z.string().min(1),
  telegraph: z.number().positive(),
  pos: Vec2Schema,
  radius: z.number().positive(),
  requiredCount: z.number().int().positive().default(1), // soakers needed to clear it
  requiredRoles: z.array(RoleSchema).min(1).optional(),
  wrongRoleLethal: z.boolean().optional(), // wrong-role soaker dies (only with requiredRoles)
  failureDamage: z.number().nonnegative(), // raidwide damage when not enough valid soakers
  failureDamageType: z.enum(["physical", "magical", "true"]),
  applyEffect: ApplyEffectSchema.optional(), // debuff applied to valid soakers on success
  knockback: KnockbackSchema.optional(),     // knockback applied to valid soakers on success
  visual: TowerVisualSchema.optional(),
});

const ChainEventSchema = z.object({
  type: z.literal("chain"),
  t: z.number().nonnegative(),
  name: z.string().min(1),
  pairs: z.array(z.tuple([z.string().min(1), z.string().min(1)])).min(1), // chained player-id pairs
  telegraph: z.number().positive(),     // cast duration (head icon + cast bar)
  breakWindow: z.number().positive(),   // seconds after the cast to move apart before damage
  breakDistance: z.number().positive(), // separation needed to break the chain
  breakDamage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  debuffName: z.string().min(1),        // debuff applied to both members at cast end
  showCastBar: z.boolean().optional(),
});

const GroupEventSchema = z.object({
  type: z.literal("group"),
  t: z.number().nonnegative(),
  name: z.string().min(1),
  id: z.string().min(1).optional(),                              // required if another event links to it
  groups: z.array(z.array(z.string().min(1)).min(1)).min(1),     // candidate groups of player ids
  rng: z.boolean().optional(),                                   // pick a random group (else groups[0])
  link: z.string().min(1).optional(),                            // take complement of the referenced group event's choice
  telegraph: z.number().positive(),
  radius: z.number().positive(),                                 // stack circle radius around the marked player
  requiredCount: z.number().int().positive().default(1),         // soakers needed inside the radius; fewer -> stack fails (full damage each)
  damage: z.number().nonnegative(),                              // total damage, split evenly among soakers on success
  damageType: z.enum(["physical", "magical", "true"]),
  applyEffect: ApplyEffectSchema.optional(),
  showCastBar: z.boolean().optional(),
});

const InverseEventSchema = z.object({
  type: z.literal("inverse"),
  t: z.number().nonnegative(),
  name: z.string().min(1),
  telegraph: z.number().positive(),                // cast/telegraph duration (seconds)
  damage: z.number().nonnegative(),
  damageType: z.enum(["physical", "magical", "true"]),
  shownShapes: z.array(AOEShapeSchema).min(1),      // telegraph shapes that ARE drawn
  hiddenShapes: z.array(AOEShapeSchema).min(1),     // not drawn; lethal when inverted ("?")
  ringColor: z.string().optional(),               // hex colour of this mechanic's boss ring (identifies it)
  ringHeight: z.number().optional(),              // vertical height of this mechanic's boss ring
  rng: z.boolean().optional(),                      // randomize the "?" inversion (else not inverted)
  questionMark: z.boolean().optional(),            // authored override of the inversion state
  applyEffect: ApplyEffectSchema.optional(),
  knockback: KnockbackSchema.optional(),
  showCastBar: z.boolean().optional(),
});

export const EventSchema = z.union([TetherSourceEventSchema, LineLinkEventSchema, AOEEventSchema, TargetedEventSchema, TowerEventSchema, ChainEventSchema, GroupEventSchema, InverseEventSchema]);

const PlayerDefSchema = z.object({
  id: z.string().min(1),
  role: RoleSchema,
  control: z.enum(["human", "bot"]).default("human"),
  spawn: Vec2Schema,
  pattern: z.array(WaypointSchema).optional(),
});

export const RaidSchema = z.object({
  name: z.string().min(1),
  arena: z.object({ zones: z.array(ZoneShapeSchema).min(1) }),
  duration: z.number().positive(),
  botPatterns: RaidIdSchema.optional(),
  players: z.array(PlayerDefSchema).length(ROSTER.length),
  events: z.array(EventSchema),
  waymarks: z.array(WaymarkSchema).optional(),
}).superRefine((raid, ctx) => {
  const seenMarks = new Set<string>();
  raid.waymarks?.forEach((waymark, i) => {
    if (seenMarks.has(waymark.mark)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
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
        code: z.ZodIssueCode.custom,
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
            code: z.ZodIssueCode.custom,
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
          code: z.ZodIssueCode.custom,
          path: ["events", i, "target", "playerIds", j],
          message: `line_link target references unknown player id "${id}"`,
        });
      }
    });
  });

  // group events: validate member ids, and that links reference an earlier 2-group event with an explicit id.
  const groupEventsById = new Map<string, { t: number; groupCount: number }>();
  raid.events.forEach(event => {
    if (event.type === "group" && event.id !== undefined) {
      groupEventsById.set(event.id, { t: event.t, groupCount: event.groups.length });
    }
  });
  raid.events.forEach((event, i) => {
    if (event.type !== "group") return;
    event.groups.forEach((group, g) => {
      group.forEach(id => {
        if (!playerIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["events", i, "groups", g],
            message: `group references unknown player id "${id}"`,
          });
        }
      });
    });
    if (event.link !== undefined) {
      const source = groupEventsById.get(event.link);
      if (!source) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", i, "link"],
          message: `link references unknown group event id "${event.link}"; the source must set an explicit id`,
        });
      } else if (source.t >= event.t) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", i, "link"],
          message: `linked group event "${event.link}" must occur earlier (t < ${event.t})`,
        });
      }
      if (event.groups.length !== 2 || (source && source.groupCount !== 2)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", i, "link"],
          message: `linked group events must have exactly 2 groups so the complement is well-defined`,
        });
      }
    }
  });
});

export const BotPatternsSchema = z.object({
  players: z.record(z.string().min(1), z.array(WaypointSchema)),
});

export type RaidDef = z.infer<typeof RaidSchema>;
export type BotPatternsDef = z.infer<typeof BotPatternsSchema>;
