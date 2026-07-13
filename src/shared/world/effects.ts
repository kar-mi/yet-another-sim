import type { Vec2 } from "../math";
import type { CrystalElement, DamageType, Role } from "./foundation";

export type EffectBehavior =
  | { kind: "none" }
  | { kind: "vuln"; damageType: "physical" | "magical"; multiplier: number }
  | { kind: "mitigation"; damageType?: DamageType; multiplier: number }
  // Generic damage-over-time. `condition` gates when a tick deals damage: "always" every tick,
  // "moving" only when the player acted this tick (old "pyretic"), "idle" only when they didn't
  // (old "freeze").
  | { kind: "dot"; dps: number; condition: "always" | "moving" | "idle" }
  // Forces the player to walk toward a locked target; on contact the target takes
  // friendly-fire damage and the debuff ends. Target is locked when the debuff lands.
  | { kind: "confusion"; damage: number; damageType: DamageType; radius: number }
  // Disables all input for the effect's duration (not broken by damage).
  | { kind: "sleep" }
  // On expiry, bursts at the carrier, then can spread follow-up AOEs to nearby/far players.
  | { kind: "burstSpread"; radius: number; damage: number; damageType: DamageType; knockbackDistance: number; selfShape?: "circle" | "donut"; selfInner?: number; followUp?: { mode: "closest" | "furthest"; count: number; originCrystal?: CrystalElement; shape: "circle" | "donut"; radius: number; inner?: number; damage: number; damageType: DamageType; knockbackDistance?: number } }
  | { kind: "effectBurst"; shape: "circle" | "donut"; radius: number; innerRadius?: number; damage: number; damageType: DamageType }
  | { kind: "twister"; delay: number; shownShape: "circle" | "donut"; hiddenShape: "circle" | "donut"; radius: number; innerRadius?: number; rng?: boolean; questionMark?: boolean; damage: number; damageType: DamageType }
  | { kind: "carrierGaze"; cone: { angleDeg: number; length: number }; damage: number; damageType: DamageType }
  | { kind: "reverseCarrierGaze"; coneHalfAngle?: number; damage: number; damageType: DamageType }
  | { kind: "pairedSpreadStack"; key: string; role: "stack" | "spread"; spread: { radius: number; damage: number }; stack: { radius: number; requiredCount: number; damage: number }; damageType: DamageType }
  | { kind: "effectCheck"; compare: [string, string]; expect: "matches" | "differs"; failureDamage: number; failureDamageType: DamageType }
  // Tele-Trouncing "plant": the HUD shows an arrow along `direction` ([x, z]). When the debuff
  // expires it places a teleport trap (forced march) at the player's spot — inert for `armDelay`
  // seconds so the placer can step off, then triggers on contact: the entrant is frozen for
  // `tpDelay` seconds, then instantly teleported `distance` along `direction`. An untriggered trap
  // expires `duration` seconds after it arms.
  | { kind: "plant"; direction: [number, number]; distance: number; radius: number; armDelay: number; duration: number; tpDelay: number }
  | { kind: "directionalKnockback"; requiredFacing: "away" | "toward"; distance: number; doubledDistance: number }
  // Reapplying escalates: with escalateTo, swaps to the next stage; without it (terminal), deals escalateDamage and stays.
  | { kind: "escalating"; escalationKey: string; escalateTo?: string; escalateDamage?: number; escalateDamageType?: DamageType }
  // Would-be-lethal hit leaves carrier at 1 HP and cleanses the debuff. Uncleansed expiry is lethal.
  | { kind: "primordialCrust"; expiryDamage: number; expiryDamageType: DamageType }
  // Cleansed by healing carrier to full HP. Uncleansed expiry is lethal.
  | { kind: "accretion"; expiryDamage: number; expiryDamageType: DamageType }
  // At expiry, require voluntary move/jump activity (or stillness) in the final time window.
  // Failure launches the carrier, then applies damage when they land.
  | { kind: "motionCheck"; required: "move" | "still"; window: number; failureDamage: number; failureDamageType: DamageType; failureKnockupHeight: number }
  // Generic assignment/priority marker (e.g. First/Second/Third in Line, Alpha/Beta). Pure HUD marker; deals expiryDamage on expiry. No cleanse path.
  | { kind: "assignment"; expiryDamage: number; expiryDamageType: DamageType };

export type EffectSpec = {
  name: string;
  kind: "buff" | "debuff";
  duration: number;
  stacks?: number;
  behavior: EffectBehavior;
  visibility?: "visible" | "invisible";
  priority?: boolean; // render before normal visible effects; stable within each band
  group?: string; // only one active effect in a group may exist on a player
  showTimer?: boolean;
  // Optional HUD icon: a bare filename served from /static/debuffs/. Falls back to a behavior glyph.
  icon?: string;
  // Optional short marker rendered above the player while the effect is active.
  marker?: string;
  // Optional above-head marker image: a bare filename served from /static/head_markers/.
  markerIcon?: string;
  markerIconScale?: number; // per-icon size multiplier (default 4)
};

export type EffectBundle = {
  effects: EffectSpec[];
  order: "listed" | "shuffle" | "shuffleBalanced";
};

export type StatusEffect = {
  id: string;
  name: string;
  kind: "buff" | "debuff";
  appliedAt: number;
  duration: number;
  stacks?: number;
  behavior: EffectBehavior;
  visibility?: "visible" | "invisible";
  priority?: boolean;
  group?: string;
  showTimer?: boolean;
  // Optional HUD icon: a bare filename served from /static/effects/. Falls back to a behavior glyph.
  icon?: string;
  // Optional short marker rendered above the player while the effect is active.
  marker?: string;
  // Optional above-head marker image: a bare filename served from /static/head_markers/.
  markerIcon?: string;
  markerIconScale?: number; // per-icon size multiplier (default 4)
  // Set when a confusion debuff lands: the player it forces this player to walk toward.
  lockedTargetId?: string;
  // Plant slot index from the assigned combo. Used by bot solvers to place each arrow separately.
  plantSlot?: number;
  // Limit Cut number (1–8) assigned by a limit_cut event. Used by bot solvers to place each
  // numbered player around the inter-inter-cardinal ring.
  limitCutNumber?: number;
};

// Generic "reassign" mechanic: distribute named charge debuffs across players, then re-balance to
// target counts after a labelled mechanic resolves. `charges` maps each kind to its effect + marker
// spec; `initial: "plan"` opens by applying world.initialCharges; `onResolve` keys a trigger label
// (e.g. a tower's label) to the per-kind target counts the re-balance should reach, dealt to that
// mechanic's just-resolved players in roster order.
export type ReassignCharge = {
  kind: string;
  effect: EffectSpec;
  marker?: EffectSpec;
};

export type Reassign = {
  id: string;
  t: number;
  name: string;
  charges: ReassignCharge[];
  initial?: "plan";
  onResolve?: Record<string, Record<string, number>>;
  initialDealt: boolean; // runtime: set once the opener (initial) deal has fired
};

export type Knockback = {
  distance: number;
  height: number; // 0 = horizontal knockback; >0 = knockup arc
  origin?: Vec2;  // defaults to the AOE shape's center/origin
};
