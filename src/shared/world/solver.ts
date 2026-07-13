import type { Vec2 } from "../math";
import type { CrystalElement, Role } from "./foundation";

export type GenericSolverRule = {
  when: {
    static?: true; // explicit always-active rule; normally used as the final fallback
    // segment-prefix match on a resolved mechanic id (e.g. "lightning-1" matches "lightning-1.inverted.b")
    // OR an exact match against one of the resolved mechanic's labels. An array requires every listed
    // mechanic to be active at once (e.g. a spread_stack mode AND a concurrent inverse orientation).
    mechanic?: string | string[];
    role?: Role | Role[];  // an array matches any of the listed roles (a bot only ever has one role)
    debuff?: string | string[];   // active effect name(s) on the bot; an array requires all of them
    partyDebuff?: string | string[]; // active effect name(s) anywhere in the party; an array requires all of them
    partnerDebuff?: string | string[]; // active effect name(s) on the bot's partner (world.partners)
    // Compares the bot's group (world.playerGroups) to the group of the first live matched mechanic.
    // true => equal (the bot soaks this wave); false => the mechanic has a group and the bot's differs.
    // Requires when.mechanic.
    soaks?: boolean;
    plant?: string;    // the bot's assigned plant combo key (e.g. "right right"); active while it carries a plant debuff
    plantSlot?: number; // restrict to a specific plant slot (short/long); omit to match either
    endingFacing?: { event: string; offset: number }; // matches world.endingOffsets[event]
  };
  startAt?: number;
  endAt?: number;
  // Optional rotated frame for spot coordinates. "matched": north = normalize(Σ positions) of the
  // live matched mechanics (e.g. a tower pair's bisector). Otherwise a list of references whose
  // positions are summed and normalized: a positioned event id (tower), { crystal } (a resolved
  // elemental crystal), or { boss } (a boss's facing direction or its position). Mixing kinds is
  // allowed. Authored framed spots use {r, z} or polar {dist, angleDeg}; load-time conversion stores
  // the lateral frame coordinate r in Vec2.x for the frame transform.
  // A rule whose frame can't be computed yields no spot (falls through).
  frame?: "matched" | FrameRef[];
  // Optional origin for framed spots. Defaults to arena center; boss origin makes spots local to
  // that boss position while still using the rule's frame for rotation.
  origin?: { boss: string };
  // For a mixed boss-facing frame, flip the lateral axis when the other references are on the
  // boss's left. This lets one authored spot mirror across east/west mechanic configurations.
  mirrorLateral?: boolean;
  // Same idea as mirrorLateral but for the frame's forward/north axis: flips when the other
  // references point behind the boss's own facing (dot product against facing itself, rather than
  // its right vector). Combine both when a single lateral mirror can't guarantee safety against a
  // second boss-facing-anchored hazard for every possible relative facing between the two bosses —
  // each axis independently forces its own spot term negative against that hazard's direction, and
  // since right/north are orthonormal, at least one of them keeps real margin for any relative
  // facing, including the degenerate case where a lateral-only mirror has none.
  mirrorForward?: boolean;
  spots?: Record<string, Vec2>; // per-player spot; wins over spot
  spot?: Vec2;                   // one spot for every matching bot
  // Limit Cut placement. Requires when.mechanic naming a fired limit cut (World.limitCuts): the
  // matched mechanic supplies the rotation basis. `spots[n-1]` is the placement for limit-cut number
  // n, authored relative to relative-north (lateral r in Vec2.x, like a frame spot); the solver
  // rotates it by that limit cut's north and mirrors it by the players' rotation direction. Returns
  // absolute coords, so this rule must not also set frame/spot/spots; bots without a number fall through.
  limitCutSpread?: { spots: Vec2[] };
  // Holds the bot at its current position while this rule is active (startAt/endAt still apply).
  // Mutually exclusive with spot/spots/frame/limitCutSpread — there's no target to compute.
  freeze?: true;
  // Sends the bot to the nearest arena-edge point (to `from`) that stays clear of a line AoE. `from`
  // and `avoid` are FrameRefs: `from` is the point the "closest edge" is measured from (e.g. a
  // tether orb via its event id); `avoid` is the line's axis direction (e.g. a boss's facing, whose
  // cleave runs through arena centre). The result stays `clearance` yalms laterally clear of that
  // axis, picking whichever safe edge point is nearest `from`. Mutually exclusive with the other
  // placement fields; falls through when either ref can't be resolved.
  nearestEdge?: { from: FrameRef; avoid: FrameRef; clearance: number };
  // Live midpoint between a Black Hole tether orb and its current tethered endpoint. Falls through
  // when the source/end can't resolve, and spotless rules also fall through when this bot already
  // holds the tether. With spot/spots authored, holders use that target pulled 1 yalm toward the
  // source orb to keep the tether.
  tetherMidpoint?: { hazardId: string; order: 0 | 1 | 2 };
};

// A single positioned reference summed into a frame's north vector: a positioned event id, a
// resolved elemental crystal, or a boss (its facing direction or its position).
export type FrameRef =
  | string
  | { crystal: CrystalElement }
  | { boss: { id?: string; from: "facing" | "position" } }
  // Kefka-relative tether soak slot: the order-th orb clockwise from the hazard's orderFrom boss.
  | { blackHoleTether: { hazardId: string; order: 0 | 1 | 2 } }
  // Physical tether orb by rotation index (0/1/2 = consecutive clockwise): a stable reference that
  // doesn't shift with the boss's position, for helper spots (drags/baits) framed on the orb cluster.
  | { blackHoleOrb: { hazardId: string; index: 0 | 1 | 2 } };

// When any mechanic matching `mechanic` (id-prefix or label, like GenericSolverRule.when.mechanic)
// resolves, bots hold their current position for `duration` seconds before re-solving.
export type SolverHold = {
  mechanic: string | string[];
  duration: number;
};

export type BotSolvers = {
  generic?: GenericSolverRule[];
  holds?: SolverHold[];
};
