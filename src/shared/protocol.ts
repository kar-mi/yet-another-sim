import { z } from "zod";
import type { Control, Intent, Role, World } from "./types";

export const MAX_PLAYERS = 8;

// Canonical raid roster: fixed ids, roles, and order. Every raid must match this exactly.
export const ROSTER: readonly { id: string; role: Role }[] = [
  { id: "mt", role: "tank" },
  { id: "ot", role: "tank" },
  { id: "h1", role: "healer" },
  { id: "h2", role: "healer" },
  { id: "r1", role: "dps" },
  { id: "r2", role: "dps" },
  { id: "m1", role: "dps" },
  { id: "m2", role: "dps" },
];

// Default clock spawns (radius 8). 12 o'clock = +z (north), 3 o'clock = +x (east), clockwise.
const CLOCK_R = 8;
const CLOCK_D = CLOCK_R / Math.SQRT2;
export const CLOCK_SPOTS: Record<string, [number, number]> = {
  mt: [0, CLOCK_R],         // 12
  r2: [CLOCK_D, CLOCK_D],   // 1:30
  h2: [CLOCK_R, 0],         // 3
  m2: [CLOCK_D, -CLOCK_D],  // 4:30
  ot: [0, -CLOCK_R],        // 6
  m1: [-CLOCK_D, -CLOCK_D], // 7:30
  h1: [-CLOCK_R, 0],        // 9
  r1: [-CLOCK_D, CLOCK_D],  // 10:30
};

export const EMPTY_RAID_ID = "empty";

export const RAID_SEGMENT_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Raid ids are an optional category prefix plus a raid segment, e.g. "debug/chain-test".
export const RAID_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63})?$/;
export const MAX_RAIDS = 50;
export const MAX_RAID_NAME_LENGTH = 60;

export type RaidEntry = { id: string; name: string };
export type RaidCategory = { id: string; name: string; description: string; raids: RaidEntry[] };

export function normalizeRaidName(name: unknown): string | null {
  if (typeof name !== "string") return null;

  const normalized = name.trim().replace(/\s+/g, " ");
  if (normalized.length === 0 || normalized.length > MAX_RAID_NAME_LENGTH) return null;
  return normalized;
}

export const RaidIdSchema = z.string().regex(RAID_ID_REGEX);
export const SessionIdSchema = z.string().regex(RAID_SEGMENT_REGEX);
export const PlayerIdSchema = z.string().min(1).max(64);

const IntentVec2Schema = z.object({
  x: z.number().min(-1).max(1),
  z: z.number().min(-1).max(1),
}).strict();

export const IntentSchema = z.object({
  move: IntentVec2Schema,
  jump: z.boolean().optional(),
  sprint: z.boolean().optional(),
  antiKnockback: z.boolean().optional(),
  provoke: z.boolean().optional(),
  toggleInvincibility: z.boolean().optional(),
}).strict() satisfies z.ZodType<Intent>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    sessionId: SessionIdSchema,
    raidId: RaidIdSchema,
  }).strict(),
  z.object({
    type: z.literal("setRaid"),
    raidId: RaidIdSchema,
  }).strict(),
  z.object({
    type: z.literal("claimSlot"),
    playerId: PlayerIdSchema,
  }).strict(),
  z.object({
    type: z.literal("releaseSlot"),
    playerId: PlayerIdSchema,
  }).strict(),
  z.object({
    type: z.literal("start"),
  }).strict(),
  z.object({
    type: z.literal("play"),
  }).strict(),
  z.object({
    type: z.literal("pause"),
  }).strict(),
  z.object({
    type: z.literal("stop"),
  }).strict(),
  z.object({
    type: z.literal("restart"),
  }).strict(),
  z.object({
    type: z.literal("debugPosition"),
    playerId: PlayerIdSchema,
    x: z.number(),
    y: z.number(),
    z: z.number(),
  }).strict(),
  z.object({
    type: z.literal("intent"),
    intent: IntentSchema,
  }).strict(),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type LobbySlot = {
  playerId: string;
  role: Role;
  control: Control;
  claimed: boolean;
  claimedByYou: boolean;
};

export type LobbyStatus = "lobby" | "running" | "paused" | "stopped" | "done";
export type PlaybackState = "playing" | "paused" | "stopped";

export type ServerMessage =
  | { type: "joined"; clientId: string }
  | {
      type: "lobby";
      sessionId: string;
      raidId: string;
      raidName: string;
      status: LobbyStatus;
      hostClientId: string;
      slots: LobbySlot[];
    }
  | { type: "started"; world: World; yourPlayerId: string }
  | { type: "playback"; state: PlaybackState; raidId: string; hostClientId: string; world: World }
  | { type: "snapshot"; world: World }
  | { type: "error"; message: string };
