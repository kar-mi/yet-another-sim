import type { Vec2 } from "./math";

export type Role = "tank" | "healer" | "dps";

export type Control = "human" | "bot";

export type Status = "running" | "cleared" | "wiped";

export type ZoneShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "rect"; center: Vec2; width: number; height: number }
  | { kind: "polygon"; vertices: Vec2[] };

export type Arena = { zones: ZoneShape[] };

export type Waypoint = { t: number; pos: Vec2 };

export type StatusEffect = {
  id: string;
  name: string;
  kind: "buff" | "debuff";
  appliedAt: number;
  duration: number;
};

export type Player = {
  id: string;
  role: Role;
  control: Control;
  pattern?: Waypoint[];
  pos: Vec2;
  y: number;
  verticalVelocity: number;
  facing: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  sprintActive: number;   // seconds remaining on sprint
  sprintCooldown: number; // seconds remaining on cooldown
  alive: boolean;
  effects: StatusEffect[];
};

export type Boss = {
  id: string;
  pos: Vec2;
  hp: number;
  maxHp: number;
  radius: number;
};

export type AOEShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "donut"; center: Vec2; inner: number; outer: number }
  | { kind: "cone"; origin: Vec2; direction: Vec2; angleDeg: number; length: number }
  | { kind: "rect"; origin: Vec2; direction: Vec2; width: number; length: number };

export type ActiveMechanic = {
  id: string;
  name: string;
  shape: AOEShape;
  telegraphStart: number;
  resolveAt: number;
  damage: number;
  resolved: boolean;
  showCastBar: boolean;
};

export type PendingEvent = {
  id: string;
  t: number;
  name: string;
  shape: AOEShape;
  telegraph: number;
  damage: number;
  showCastBar: boolean;
};

export type LogEntry = {
  t: number;
  mechanic: string;
  playerId: string;
  event: "hit" | "fell" | "cleared";
};

export type TetherSource = {
  id: string;
  pos: Vec2;
  spawnAt: number;
  finalizeAt: number;
  tetherKind: "buff" | "debuff";
  buffName: string;
  tetheredPlayerId: string | null;
  finalized: boolean;
};

export type PendingTether = {
  id: string;
  t: number;
  pos: Vec2;
  finalizeAfter: number;
  tetherKind: "buff" | "debuff";
  buffName: string;
};

export type Intent = {
  move: Vec2;
  jump?: boolean;
  sprint?: boolean;
};

export type Intents = Record<string, Intent>;

export type World = {
  time: number;
  status: Status;
  arena: Arena;
  players: Player[];
  boss: Boss;
  active: ActiveMechanic[];
  pending: PendingEvent[];
  log: LogEntry[];
  duration: number;
  tetherSources: TetherSource[];
  pendingTethers: PendingTether[];
};
