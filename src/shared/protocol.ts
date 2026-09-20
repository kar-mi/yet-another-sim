import { z } from "zod";
import type { Control, Intent, Intents, Role, World } from "./types";

export const MAX_OBSERVERS = 5;

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
  // Host returning to the lobby (Home). Stops the pull like "stop" but the server does not send the
  // leaving host a "started" message (which the lobby would treat as a re-entry into the sim).
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
  // Host-only: the replay every client in the session should be watching, or null for the live sim.
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
  // Lockstep: the host signals that its local sim reached a terminal state (wiped/cleared) so the
  // server can stop relaying and mark the pull done.
  z.strictObject({
    type: z.literal("simEnded"),
    tick: z.number().int().nonnegative(),
  }),
  // Lockstep: clients periodically report a hash of their local world for desync detection.
  z.strictObject({
    type: z.literal("worldHash"),
    tick: z.number().int().nonnegative(),
    hash: z.number().int(),
  }),
  // Lockstep: host-only periodic world snapshot for late-join anchoring. The server stores and
  // relays this opaquely — it never interprets it. Trust note: the host is already canonical via
  // DesyncTracker; accepting its world snapshot adds no new trust surface.
  z.strictObject({
    type: z.literal("snapshot"),
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
export type TransitionReason = "hostLost" | "noParticipants";

// One simulated tick's worth of authoritative input in server-relayed lockstep. `intents` holds the
// merged human intents keyed by playerId (a slot is human-controlled this tick exactly when it has
// an entry — clients derive `control` from these keys so bot computation stays identical). A frame
// carries no world state: every client steps `tick()` locally from these inputs.
// `botsInvisible` is absent in replays recorded before bot invisibility existed; readers treat a
// missing value as false.
export type Frame = { intents: Intents; botsInvincible: boolean; botsInvisible?: boolean };

// Shared replay playback position. The recording itself is fetched over HTTP by each client.
export type ReplayView = { pull: number; playing: boolean; tick: number };

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
  // The pull's world at `baseTick` plus the input log tail from baseTick to `tick`. On a fresh start
  // baseTick is 0 and frames is empty. For a late join / resync anchored to a host snapshot,
  // baseTick is the snapshot tick and frames is only the tail — the client adopts the world and
  // replays just the tail instead of the full log.
  | { type: "started"; world: World; baseTick: number; yourPlayerId: string | null; tick: number; frames: Frame[] }
  | { type: "playback"; state: PlaybackState; phase: SessionPhase; raidId: string; hostParticipantId: string; rngDecisions: DecisionDescription[] }
  | { type: "transition"; phase: SessionPhase; reason: TransitionReason }
  | { type: "sessionExpired" }
  // Incremental input frames to step locally. `startTick` is the tick index of the first frame.
  | { type: "frames"; startTick: number; frames: Frame[] }
  // The replay the host is showing everyone (null = live sim). A playing view's tick is current as of send.
  | { type: "replay"; view: ReplayView | null }
  | { type: "error"; message: string };
