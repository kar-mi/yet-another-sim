import type { Vec2 } from "@shared/math";
import type { Control, Role, Waypoint } from "./foundation";
import type { StatusEffect } from "./effects";

export type Player = {
  id: string;
  role: Role;
  control: Control;
  pattern?: Waypoint[];
  botWaypointResumeAfter?: number;
  pos: Vec2;
  y: number;
  verticalVelocity: number;
  knockbackVelocity: Vec2;
  lastMotionAt?: number;
  facing: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  sprintCooldown: number;
  antiKbCooldown: number;
  provokeCooldown: number;
  targetBossId: string;
  cooldownsDisabled: boolean;
  invincible: boolean;
  alive: boolean;
  effects: StatusEffect[];
};

export type Boss = {
  showInBossList?: boolean;
  id: string;
  pos: Vec2;
  hp: number;
  maxHp: number;
  radius: number;
  facing: number;
  currentTarget: string | null;
  threat: Record<string, number>;
  ringScale: number;
  ringColor: string;
  model: string;
  modelScale: number;
  targetable: boolean;
  hidden: boolean;
  sinkFraction: number;
};

export type Intent = {
  move: Vec2;
  facing?: number;
  solverDirected?: boolean;
  jump?: boolean;
  sprint?: boolean;
  antiKnockback?: boolean;
  provoke?: boolean;
  cycleTarget?: boolean;
  toggleInvincibility?: boolean;
  toggleCooldowns?: boolean;
};

export type Intents = Record<string, Intent>;
