import { z } from "zod";
import type { Control, Intent, Role, World } from "./types";

export const MAX_PLAYERS = 8;
export const EMPTY_RAID_ID = "empty";

export const RaidIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const SessionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const PlayerIdSchema = z.string().min(1).max(64);

const IntentVec2Schema = z.object({
  x: z.number().min(-1).max(1),
  z: z.number().min(-1).max(1),
}).strict();

export const IntentSchema = z.object({
  move: IntentVec2Schema,
  jump: z.boolean().optional(),
  sprint: z.boolean().optional(),
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
