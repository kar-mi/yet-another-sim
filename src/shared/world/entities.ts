import type { Vec2 } from "../math";
import type { Control, Role, Waypoint } from "./foundation";
import type { StatusEffect } from "./effects";

export type Player = {
  id: string;
  role: Role;
  control: Control;
  pattern?: Waypoint[];
  botWaypointResumeAfter?: number; // forced movement ignores authored waypoints at or before this time
  pos: Vec2;
  y: number;
  verticalVelocity: number;
  knockbackVelocity: Vec2; // horizontal forced-movement velocity (knockback/knockup)
  lastMotionAt?: number; // last voluntary horizontal movement or jump
  facing: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  sprintActive: number;   // seconds remaining on sprint
  sprintCooldown: number; // seconds remaining on cooldown
  antiKbActive: number;   // seconds remaining on anti-knockback buff
  antiKbCooldown: number; // seconds remaining on anti-knockback cooldown
  provokeCooldown: number; // seconds remaining on provoke cooldown (tank threat grab)
  targetBossId: string;   // which boss this player is focused on (used by provoke + target ring)
  invincible: boolean;    // when true, takes no damage and cannot die (practice mode)
  alive: boolean;
  effects: StatusEffect[];
};

export type Boss = {
  id: string;
  pos: Vec2;
  hp: number;
  maxHp: number;
  radius: number;
  facing: number;                  // radians, 0 = +Z (matches player facing convention)
  currentTarget: string | null;    // player id with top threat
  threat: Record<string, number>;  // playerId -> threat value
  ringScale: number;               // floor-ring visual scale (BossRingLayer)
  ringColor: string;               // floor-ring hex color
  model: string;                   // glb filename stem under /static/model/ (without extension)
  modelScale: number;              // multiplier applied on top of the base model scale
  targetable: boolean;
  hidden: boolean;                 // when true, the model is not drawn (e.g. boss ducked under the map)
  sinkFraction: number;             // 0..1 fraction of model body height sunk below the ground (e.g. boss positioned under the map)
};

export type Intent = {
  move: Vec2;
  facing?: number;             // absolute facing in radians (atan2(x, z)); when set, overrides movement-derived facing
  solverDirected?: boolean;    // bot only: solver is actively steering this tick; stamp botWaypointResumeAfter
  jump?: boolean;
  sprint?: boolean;
  antiKnockback?: boolean;
  provoke?: boolean;
  cycleTarget?: boolean;
  toggleInvincibility?: boolean;
};

export type Intents = Record<string, Intent>;
