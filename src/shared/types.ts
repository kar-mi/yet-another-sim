import type { Vec2 } from "./math";

export type Role = "tank" | "healer" | "dps";

export type Status = "running" | "cleared" | "wiped";

export type ZoneShape =
  | { kind: "circle"; center: Vec2; radius: number }
  | { kind: "rect"; center: Vec2; width: number; height: number }
  | { kind: "polygon"; vertices: Vec2[] };

export type Arena = { zones: ZoneShape[] };

export type Player = {
  id: string;
  role: Role;
  pos: Vec2;
  y: number;
  verticalVelocity: number;
  facing: number;
  hp: number;
  alive: boolean;
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
};

export type PendingEvent = {
  id: string;
  t: number;
  name: string;
  shape: AOEShape;
  telegraph: number;
  damage: number;
};

export type LogEntry = {
  t: number;
  mechanic: string;
  playerId: string;
  event: "hit" | "fell" | "cleared";
};

export type Intent = {
  move: Vec2;
  jump?: boolean;
};

export type Intents = Record<string, Intent>;

export type World = {
  time: number;
  status: Status;
  arena: Arena;
  players: Player[];
  active: ActiveMechanic[];
  pending: PendingEvent[];
  log: LogEntry[];
  duration: number;
};
