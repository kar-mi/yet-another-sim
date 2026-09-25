import { z } from "zod";
import type { Control, Intent, Intents, Role, World } from "./types";

export const MAX_OBSERVERS = 5;

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

const CLOCK_R = 8;
const CLOCK_D = CLOCK_R / Math.SQRT2;
export const CLOCK_SPOTS: Record<string, [number, number]> = {
  mt: [0, CLOCK_R],
  r2: [CLOCK_D, CLOCK_D],
  h2: [CLOCK_R, 0],
  m2: [CLOCK_D, -CLOCK_D],
  ot: [0, -CLOCK_R],
  m1: [-CLOCK_D, -CLOCK_D],
  h1: [-CLOCK_R, 0],
  r1: [-CLOCK_D, CLOCK_D],
};

export const EMPTY_RAID_ID = "empty";

export const RAID_SEGMENT_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const RAID_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63})?$/;
export const MAX_RAIDS = 50;
export const PARTICIPANT_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_RAID_NAME_LENGTH = 60;

export type RaidEntry = { id: string; name: string };
export type RaidCategory = { id: string; name: string; description: string; raids: RaidEntry[] };
export type DecisionDescription = { key: string; label: string; options: string[] };
export type BotPatternOption = { id: string; name: string };

export function normalizeRaidName(name: unknown): string | null {
  if (typeof name !== "string") return null;

  const normalized = name.trim().replace(/\s+/g, " ");
  if (normalized.length === 0 || normalized.length > MAX_RAID_NAME_LENGTH) return null;
  return normalized;
}

export const RaidIdSchema = z.string().regex(RAID_ID_REGEX);
export const SessionIdSchema = z.string().regex(RAID_SEGMENT_REGEX);
export const ParticipantIdSchema = z.string().regex(PARTICIPANT_ID_REGEX);
const PlayerIdSchema = z.string().min(1).max(64);

const IntentVec2Schema = z.strictObject({
  x: z.number().min(-1).max(1),
  z: z.number().min(-1).max(1),
});

const IntentSchema = z.strictObject({
  move: IntentVec2Schema,
  facing: z.number().optional(),
  jump: z.boolean().optional(),
  sprint: z.boolean().optional(),
  antiKnockback: z.boolean().optional(),
  provoke: z.boolean().optional(),
  cycleTarget: z.boolean().optional(),
  toggleInvincibility: z.boolean().optional(),
  toggleCooldowns: z.boolean().optional(),
}) satisfies z.ZodType<Intent>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("join"),
    sessionId: SessionIdSchema,
    raidId: RaidIdSchema,
    participantId: ParticipantIdSchema,
  }),
  z.strictObject({
    type: z.literal("setRaid"),
    raidId: RaidIdSchema,
  }),
  z.strictObject({
    type: z.literal("claimSlot"),
    playerId: PlayerIdSchema,
  }),
  z.strictObject({
    type: z.literal("releaseSlot"),
    playerId: PlayerIdSchema,
  }),
  z.strictObject({
    type: z.literal("claimObserver"),
  }),
  z.strictObject({
    type: z.literal("releaseObserver"),
  }),
  z.strictObject({
    type: z.literal("start"),
  }),
  z.strictObject({
    type: z.literal("enterWorkshop"),
  }),
  z.strictObject({
    type: z.literal("play"),
  }),
  z.strictObject({
    type: z.literal("pause"),
  }),
  z.strictObject({
    type: z.literal("stop"),
  }),
  z.strictObject({
    type: z.literal("leave"),
  }),
  z.strictObject({
    type: z.literal("restart"),
  }),
  z.strictObject({
    type: z.literal("setRngConstraints"),
    constraints: z.record(z.string(), z.number()),
  }),
  z.strictObject({
    type: z.literal("setWaymarkPreset"),
    presetId: z.string().nullable(),
  }),
  z.strictObject({
    type: z.literal("setHintsEnabled"),
    enabled: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("setBotPattern"),
    patternId: z.string(),
  }),
  z.strictObject({
    type: z.literal("setBotsInvincible"),
    enabled: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("setBotsInvisible"),
    enabled: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("setReplay"),
    view: z.strictObject({
      pull: z.number().int().nonnegative(),
      playing: z.boolean(),
      tick: z.number().int().nonnegative(),
    }).nullable(),
  }),
  z.strictObject({
    type: z.literal("debugPosition"),
    playerId: PlayerIdSchema,
    x: z.number(),
    y: z.number(),
    z: z.number(),
  }),
  z.strictObject({
    type: z.literal("intent"),
    intent: IntentSchema,
  }),
  z.strictObject({
    type: z.literal("simEnded"),
    pull: z.number().int().nonnegative(),
    tick: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("worldHash"),
    pull: z.number().int().nonnegative(),
    tick: z.number().int().nonnegative(),
    hash: z.number().int(),
  }),
  z.strictObject({
    type: z.literal("snapshot"),
    pull: z.number().int().nonnegative(),
    formatVersion: z.number().int().nonnegative(),
    tick: z.number().int().nonnegative(),
    world: z.unknown(),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type LobbySlot = {
  playerId: string;
  role: Role;
  control: Control;
  claimed: boolean;
  claimedByYou: boolean;
  queuedByYou: boolean;
};

export type SessionPhase = "setup" | "workshop" | "raid";
export type PlaybackState = "idle" | "playing" | "paused" | "stopped" | "done";
export type TransitionReason = "noParticipants";

export type Frame = { intents: Intents; botsInvincible: boolean; botsInvisible?: boolean };

export type ReplayView = { pull: number; playing: boolean; tick: number };

export type SystemEvent =
  | { kind: "joined"; connected: number }
  | { kind: "left"; connected: number }
  | { kind: "hostChanged"; hostParticipantId: string }
  | { kind: "slotClaimed"; playerId: string }
  | { kind: "slotReleased"; playerId: string }
  | { kind: "raidSelected"; raidName: string };

export type ServerMessage =
  | { type: "joined"; participantId: string }
  | {
      type: "lobby";
      sessionId: string;
      raidId: string;
      raidName: string;
      phase: SessionPhase;
      playbackState: PlaybackState;
      selectedRaidId: string;
      hostParticipantId: string;
      slots: LobbySlot[];
      rngConstraints: Record<string, number>;
      rngDecisions: DecisionDescription[];
      waymarkPresetId: string | null;
      hintsEnabled: boolean;
      botPatternOptions: BotPatternOption[];
      botPatternId: string | null;
      botsInvincible: boolean;
      botsInvisible: boolean;
      observerCount: number;
      maxObservers: number;
      observingByYou: boolean;
      observerQueuedByYou: boolean;
    }
  | { type: "rngConstraintsResult"; ok: boolean }
  | { type: "started"; pull: number; world: World; baseTick: number; yourPlayerId: string | null; tick: number; frames: Frame[] }
  | { type: "playback"; state: PlaybackState; phase: SessionPhase; raidId: string; hostParticipantId: string; rngDecisions: DecisionDescription[] }
  | { type: "transition"; phase: SessionPhase; reason: TransitionReason }
  | { type: "sessionExpired" }
  | { type: "frames"; startTick: number; frames: Frame[] }
  | { type: "replay"; view: ReplayView | null }
  | { type: "system"; at: number; event: SystemEvent }
  | { type: "error"; message: string };
