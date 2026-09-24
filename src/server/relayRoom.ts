import { TICK_RATE } from "@shared/constants";
import { createWorld } from "../engine/world";
import { makeSeed } from "@shared/rng";
import type { RaidDef } from "../engine/schema/raidSchema";
import { EMPTY_RAID_ID, MAX_OBSERVERS, type BotPatternOption, type ClientMessage, type Frame, type LobbySlot, type PlaybackState, type ReplayView, type ServerMessage, type SessionPhase, type TransitionReason } from "@model/protocol";
import type { Intent, Intents, World } from "@model/types";
import { logger } from "@shared/logger";
import { WAYMARK_PRESETS, isWaymarkPresetId } from "@model/waymarkPresets";
import { describeDecisions, validateRngConstraints } from "../engine/seedSearch";
import type { RngConstraints } from "../engine/preRoll";
import { DesyncTracker } from "./desyncTracker";
import { FrameRelay } from "./frameRelay";
import { createEmptyRaid, mergePendingIntent, type SessionLog } from "./sessionRaid";
import { PullSnapshot } from "./pullSnapshot";

function botPatternOptionsFor(raid: RaidDef): BotPatternOption[] {
  if (raid.botPatternOptions) return raid.botPatternOptions.map(option => ({ id: option.id, name: option.name }));
  if (raid.botPatterns) return [{ id: "default", name: "Default" }];
  return [];
}

function defaultBotPatternId(raid: RaidDef): string | null {
  return botPatternOptionsFor(raid)[0]?.id ?? null;
}

function sameConstraints(a: RngConstraints, b: RngConstraints): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

export const LOBBY_TIMEOUT_MS = 10 * 60 * 1000;
export const EMPTY_LOBBY_TIMEOUT_MS = 90 * 1000;

export interface CapacitySnapshot {
  sessions: number;
  maxSessions: number;
  availableSessions: number;
}

export function capacitySnapshot(sessions: number, maxSessions: number): CapacitySnapshot {
  return { sessions, maxSessions, availableSessions: Math.max(0, maxSessions - sessions) };
}

export interface RelayRoomInitOptions {
  id: string;
  raidId: string;
  raid: RaidDef;
  now?: () => number;
  autoTick?: boolean;
  lobbyTimeoutMs?: number;
  createSessionLog?: (sessionId: string) => SessionLog;
}

type Send = (clientId: string, message: ServerMessage) => void;
const idleIntent: Intent = { move: { x: 0, z: 0 } };

export class RelayRoom {
  id = "";
  raidId = "";
  selectedRaidId = "";
  phase: SessionPhase = "setup";
  playback: PlaybackState = "idle";
  readonly slots = new Map<string, string | null>();
  readonly observers = new Set<string>();
  readonly pullRoster = new Map<string, string>();
  readonly pullObservers = new Set<string>();
  hostParticipantId = "";
  world!: World;

  private raid!: RaidDef;
  private selectedRaid!: RaidDef;
  private readonly workshopRaid = createEmptyRaid();
  private readonly connections = new Map<string, string>();
  private readonly participants = new Map<string, string>();
  private send!: Send;
  private readonly latestIntents = new Map<string, Intent>();
  private now: () => number = Date.now;
  private lastActivity = 0;
  private lobbyTimeoutMs = LOBBY_TIMEOUT_MS;
  private relay!: FrameRelay;
  private autoTick = true;
  private desync!: DesyncTracker;
  private createSessionLog: ((sessionId: string) => SessionLog) | null = null;
  private sessionLog: SessionLog | null = null;
  private pullNumber = 0;
  private botsInvincible = false;
  private botsInvisible = false;
  private readonly pullSnapshot = new PullSnapshot();
  private rngConstraints: RngConstraints = {};
  private waymarkPresetId: string | null = null;
  private botPatternId: string | null = null;
  private lastSeed: number | null = null;
  private replayView: (ReplayView & { at: number }) | null = null;

  get inputLog(): Frame[] {
    return this.relay.inputLog;
  }

  init(options: RelayRoomInitOptions & { send: Send }): void {
    this.send = options.send;
    this.id = options.id;
    this.raidId = options.raidId;
    this.selectedRaidId = options.raidId;
    this.raid = options.raid;
    this.selectedRaid = options.raid;
    this.botPatternId = defaultBotPatternId(this.selectedRaid);
    this.now = options.now ?? Date.now;
    this.lobbyTimeoutMs = options.lobbyTimeoutMs ?? LOBBY_TIMEOUT_MS;
    this.createSessionLog = options.createSessionLog ?? null;
    this.lastActivity = this.now();
    this.desync = new DesyncTracker({ sessionId: this.id, now: this.now, onDesync: participantId => this.resync(participantId) });
    this.autoTick = options.autoTick ?? true;
    this.relay = new FrameRelay({
      now: this.now,
      autoTick: this.autoTick,
      sessionLog: () => this.sessionLog,
      buildFrame: () => this.buildFrame(),
      onFrames: (startTick, frames) => this.broadcastAll({ type: "frames", startTick, frames }),
      onCeiling: () => this.endPullDefensively(),
      isRunning: () => this.playback === "playing",
    });

    for (const player of this.selectedRaid.players) this.slots.set(player.id, null);
    this.world = this.freshWorld();
    this.resetPull();
  }

  private sendTo(participantId: string, message: ServerMessage): void {
    const clientId = this.connections.get(participantId);
    if (clientId === undefined) return;
    this.send(clientId, message);
  }

  join(clientId: string, participantId: string): void {
    this.touch();
    const previousClientId = this.connections.get(participantId);
    const reconnecting = previousClientId !== undefined;
    if (previousClientId !== undefined) this.participants.delete(previousClientId);
    this.connections.set(participantId, clientId);
    this.participants.set(clientId, participantId);
    if (!this.hostParticipantId) this.hostParticipantId = participantId;

    if (reconnecting && this.phase === "raid") {
      if (participantId === this.hostParticipantId) {
        this.endRaidToWorkshop("hostLost");
      } else if (this.leavePull(participantId)) {
        if (this.pullIsAbandoned()) this.endRaidToWorkshop("noParticipants");
        else this.broadcastLobby();
      }
    }

    this.sendLobby(participantId);
    this.sendReplay(participantId);
    logger.info("session", "client joined", { session: this.id, participantId, clients: this.connections.size });
  }

  handle(participantId: string, message: Exclude<ClientMessage, { type: "join" | "setRaid" | "setBotPattern" }>): void {
    this.touch();
    switch (message.type) {
      case "claimSlot":
        this.claimSlot(participantId, message.playerId);
        return;
      case "releaseSlot":
        this.releaseSlot(participantId, message.playerId);
        return;
      case "claimObserver":
        this.claimObserver(participantId);
        return;
      case "releaseObserver":
        this.releaseObserver(participantId);
        return;
      case "enterWorkshop":
        this.enterWorkshop(participantId);
        return;
      case "start":
        this.start(participantId);
        return;
      case "play":
        this.play(participantId);
        return;
      case "pause":
        this.pause(participantId);
        return;
      case "stop":
        this.stop(participantId);
        return;
      case "leave":
        this.leave(participantId);
        return;
      case "restart":
        this.restart(participantId);
        return;
      case "setRngConstraints":
        this.applyRngConstraints(participantId, message.constraints);
        return;
      case "setWaymarkPreset":
        this.setWaymarkPreset(participantId, message.presetId);
        return;
      case "setBotsInvincible":
        this.setBotsInvincible(participantId, message.enabled);
        return;
      case "setBotsInvisible":
        this.setBotsInvisible(participantId, message.enabled);
        return;
      case "intent":
        this.setIntent(participantId, message.intent);
        return;
      case "simEnded":
        this.simEnded(participantId, message.tick);
        return;
      case "worldHash":
        this.reportWorldHash(participantId, message.tick, message.hash);
        return;
      case "snapshot":
        this.acceptSnapshot(participantId, message.formatVersion, message.tick, message.world);
        return;
      case "setReplay":
        this.setReplay(participantId, message.view);
        return;
    }
  }

  setRaid(participantId: string, raidId: string, raid: RaidDef): void {
    this.touch();
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can change the raid");
      return;
    }
    if (this.phase === "raid" && this.playback === "playing") {
      this.sendError(participantId, "Stop or pause before changing raid");
      return;
    }
    if (raidId === this.selectedRaidId) return;

    this.selectedRaidId = raidId;
    this.selectedRaid = raid;
    this.rngConstraints = {};
    this.waymarkPresetId = null;
    this.botPatternId = defaultBotPatternId(this.selectedRaid);

    if (this.phase === "setup" || raidId === EMPTY_RAID_ID) {
      this.raidId = raidId;
      this.raid = raid;
      this.world = this.freshWorld();
      this.broadcastLobby();
      logger.info("session", "raid selected", { session: this.id, raid: this.selectedRaidId });
      return;
    }

    this.relay.stop();
    this.closePullLog();
    this.phase = "raid";
    this.loadPull(raidId, raid, "stopped");
    this.broadcastLobby();
    this.broadcastStarted();
    this.broadcastPlayback();
    logger.info("session", "raid selected", { session: this.id, raid: this.selectedRaidId });
  }

  enterWorkshop(participantId: string): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can open the lobby");
      return;
    }
    if (this.phase === "workshop") return;
    if (this.phase === "raid" && this.playback === "playing") {
      this.sendError(participantId, "Stop the raid before opening the lobby");
      return;
    }

    this.closePullLog();
    this.phase = "workshop";
    this.loadPull(EMPTY_RAID_ID, this.workshopRaid, "playing");
    this.relay.start();
    this.broadcastLobby();
    this.broadcastStarted();
    this.broadcastPlayback();
    logger.info("session", "workshop opened", { session: this.id });
  }

  play(participantId: string): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can play");
      return;
    }
    if (this.phase === "setup") {
      this.sendError(participantId, "Open the lobby before playing");
      return;
    }
    if (this.playback === "playing") return;
    if (this.playback === "done") {
      this.sendError(participantId, "Cannot play after session ends");
      return;
    }

    const wasStopped = this.playback === "stopped";
    this.playback = "playing";
    if (wasStopped) this.openPullLog();
    this.relay.start();
    if (wasStopped) {
      this.broadcastLobby();
      this.broadcastStarted();
    }
    this.broadcastPlayback();
    logger.info("session", "resumed", { session: this.id, raid: this.raidId });
  }

  pause(participantId: string): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can pause");
      return;
    }
    if (this.playback !== "playing") return;

    this.relay.flush();
    this.playback = "paused";
    this.relay.stop();
    this.broadcastPlayback();
    logger.info("session", "paused", { session: this.id, raid: this.raidId });
  }

  stop(participantId: string): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can stop");
      return;
    }
    if (this.phase === "setup") return;

    this.relay.stop();
    this.closePullLog();
    this.loadPull(this.raidId, this.raid, "stopped");
    this.broadcastLobby();
    this.broadcastStarted();
    this.broadcastPlayback();
    logger.info("session", "raid stopped", { session: this.id, raid: this.raidId });
  }

  setReplay(participantId: string, view: ReplayView | null): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can control replays");
      return;
    }
    const opening = view !== null && view.pull !== this.replayView?.pull;
    if (opening && this.phase !== "setup" && this.playback !== "stopped") this.stop(participantId);
    this.replayView = view ? { ...view, at: this.now() } : null;
    this.broadcastAll(this.replayMessage());
  }

  sendReplay(participantId: string): void {
    this.sendTo(participantId, this.replayMessage());
  }

  private clearReplay(): void {
    if (!this.replayView) return;
    this.replayView = null;
    this.broadcastAll(this.replayMessage());
  }

  private replayMessage(): ServerMessage {
    const view = this.replayView;
    if (!view) return { type: "replay", view: null };
    const elapsed = view.playing ? Math.floor((this.now() - view.at) * TICK_RATE / 1000) : 0;
    return { type: "replay", view: { pull: view.pull, playing: view.playing, tick: view.tick + elapsed } };
  }

  leave(participantId: string): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can leave to the lobby");
      return;
    }
    this.clearReplay();
    if (this.phase === "raid") {
      this.endRaidToWorkshop(null, participantId);
      logger.info("session", "host returned to setup", { session: this.id, raid: this.raidId });
    }
  }

  restart(participantId: string): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can restart");
      return;
    }
    if (this.phase === "setup") {
      this.sendError(participantId, "Open the lobby before restarting");
      return;
    }

    this.relay.stop();
    this.closePullLog();
    this.loadPull(this.raidId, this.raid, "playing");
    this.openPullLog();
    this.relay.start();
    this.broadcastPlayback();
    this.broadcastLobby();
    this.broadcastStarted();
    logger.info("session", "raid restarted", { session: this.id, raid: this.raidId });
  }

  disconnectClient(clientId: string): boolean {
    const participantId = this.participants.get(clientId);
    if (participantId === undefined) return false;
    if (this.connections.get(participantId) !== clientId) {
      this.participants.delete(clientId);
      return false;
    }

    this.touch();
    this.participants.delete(clientId);
    this.connections.delete(participantId);
    logger.info("session", "client disconnected", { session: this.id, participantId, clients: this.connections.size });

    for (const [playerId, ownerId] of this.slots) {
      if (ownerId === participantId) this.slots.set(playerId, null);
    }
    this.observers.delete(participantId);
    this.leavePull(participantId);

    const hostChanged = this.hostParticipantId === participantId;
    if (hostChanged) {
      this.hostParticipantId = this.connections.keys().next().value ?? "";
    }

    this.applySlotControlsToWorld();
    if (this.connections.size === 0) {
      this.dispose();
      return true;
    }

    if (this.phase === "raid" && (hostChanged || this.pullIsAbandoned())) {
      this.endRaidToWorkshop(hostChanged ? "hostLost" : "noParticipants");
      if (hostChanged) this.clearReplay();
      return false;
    }

    this.broadcastLobby();
    if (hostChanged) {
      this.broadcastPlayback();
      this.clearReplay();
    }
    return false;
  }

  claimSlot(participantId: string, playerId: string): void {
    if (!this.slots.has(playerId)) {
      this.sendError(participantId, "Unknown player slot");
      return;
    }
    if (this.observers.has(participantId)) {
      this.sendError(participantId, "Leave observer mode before claiming a slot");
      return;
    }

    const ownedSlot = this.playerForParticipant(participantId);
    if (ownedSlot === playerId) {
      this.sendLobby(participantId);
      return;
    }
    if (ownedSlot) {
      this.sendError(participantId, "You already claimed a slot");
      return;
    }

    const ownerId = this.slots.get(playerId);
    if (ownerId && ownerId !== participantId) {
      this.sendError(participantId, "Slot is already claimed");
      return;
    }

    this.slots.set(playerId, participantId);
    if (this.pullIsLive()) {
      this.broadcastLobby();
      return;
    }

    this.pullRoster.set(playerId, participantId);
    this.applySlotControlsToWorld();
    this.broadcastLobby();
    if (this.phase === "workshop" || this.playback === "stopped") {
      this.sendTo(participantId, this.startedMessage(playerId));
    }
  }

  releaseSlot(participantId: string, playerId: string): void {
    if (this.slots.get(playerId) !== participantId) {
      this.sendError(participantId, "You do not own that slot");
      return;
    }

    this.slots.set(playerId, null);
    this.leavePull(participantId);
    this.broadcastLobby();
  }

  claimObserver(participantId: string): void {
    if (this.playerForParticipant(participantId)) {
      this.sendError(participantId, "Release your slot before observing");
      return;
    }
    if (this.observers.has(participantId)) {
      this.sendLobby(participantId);
      return;
    }
    if (this.observers.size >= MAX_OBSERVERS) {
      this.sendError(participantId, "Observer seats are full");
      return;
    }

    this.observers.add(participantId);
    if (this.pullIsLive()) {
      this.broadcastLobby();
      return;
    }

    this.pullObservers.add(participantId);
    this.broadcastLobby();
    if (this.phase === "workshop") this.sendTo(participantId, this.startedMessage(null));
  }

  releaseObserver(participantId: string): void {
    if (!this.observers.delete(participantId)) return;
    this.pullObservers.delete(participantId);
    this.broadcastLobby();
  }

  start(participantId: string): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can start");
      return;
    }
    if (this.phase !== "workshop") {
      this.sendError(participantId, this.phase === "setup" ? "Open the lobby before starting" : "Session already started");
      return;
    }
    if (this.selectedRaidId === EMPTY_RAID_ID) {
      this.sendError(participantId, "Select a raid before starting");
      return;
    }
    if (![...this.slots.values()].some(ownerId => ownerId !== null) && !this.observers.has(participantId)) {
      this.sendError(participantId, "Claim a slot or observer seat before starting");
      return;
    }

    this.relay.stop();
    this.closePullLog();
    this.phase = "raid";
    this.loadPull(this.selectedRaidId, this.selectedRaid, "playing");
    this.openPullLog();
    this.broadcastLobby();
    this.broadcastStarted();
    this.broadcastPlayback();
    this.relay.start();
    logger.info("session", "raid started", { session: this.id, raid: this.raidId });
  }

  setIntent(participantId: string, intent: Intent): void {
    if (this.playback !== "playing") return;
    const playerId = this.rosterPlayerFor(participantId);
    if (!playerId) return;
    this.latestIntents.set(playerId, mergePendingIntent(this.latestIntents.get(playerId), intent));
  }

  setBotsInvincible(participantId: string, enabled: boolean): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can change bot invincibility");
      return;
    }

    this.botsInvincible = enabled;
    this.applyBotsInvincible();
    this.broadcastLobby();
  }

  setBotsInvisible(participantId: string, enabled: boolean): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can change bot invisibility");
      return;
    }

    this.botsInvisible = enabled;
    this.world = { ...this.world, botsInvisible: enabled };
    this.broadcastLobby();
  }

  setWaymarkPreset(participantId: string, presetId: string | null): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can set the waymark preset");
      return;
    }
    if (presetId !== null && !isWaymarkPresetId(presetId)) {
      this.sendError(participantId, "Unknown waymark preset");
      return;
    }

    this.waymarkPresetId = presetId;
    this.refreshFrozenWorld();
    this.broadcastLobby();
  }

  setBotPattern(participantId: string, patternId: string, raid: RaidDef): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can set the bot pattern");
      return;
    }

    this.selectedRaid = raid;
    this.botPatternId = patternId;
    if (this.phase === "raid") this.raid = raid;
    this.refreshFrozenWorld();
    this.broadcastLobby();
  }

  private refreshFrozenWorld(): void {
    if (this.phase === "setup" || this.playback === "playing") return;
    this.world = this.freshWorld();
    this.applyBotsInvincible();
    this.resetPull();
    this.broadcastStarted();
  }

  private applyRngConstraints(participantId: string, constraints: Record<string, number>): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can set RNG constraints");
      return;
    }
    const validated = validateRngConstraints(this.selectedRaid, constraints);
    if (validated === null) {
      this.sendTo(participantId, { type: "rngConstraintsResult", ok: false });
      return;
    }
    if (sameConstraints(validated, this.rngConstraints)) {
      this.sendTo(participantId, { type: "rngConstraintsResult", ok: true });
      return;
    }
    this.rngConstraints = validated;
    this.refreshFrozenWorld();
    this.sendTo(participantId, { type: "rngConstraintsResult", ok: true });
    this.broadcastLobby();
  }

  step(broadcast = true): void {
    if (this.playback !== "playing") return;
    this.relay.produceFrame();
    if (broadcast) this.relay.flush();
  }

  private buildFrame(): Frame {
    const intents: Intents = {};
    for (const playerId of this.pullRoster.keys()) {
      const latestIntent = this.latestIntents.get(playerId) ?? idleIntent;
      intents[playerId] = latestIntent;
      this.latestIntents.set(playerId, { move: latestIntent.move, facing: latestIntent.facing });
    }
    return { intents, botsInvincible: this.botsInvincible, botsInvisible: this.botsInvisible };
  }

  private loadPull(raidId: string, raid: RaidDef, playback: PlaybackState): void {
    this.raidId = raidId;
    this.raid = raid;
    this.playback = playback;
    this.latestIntents.clear();
    this.freezeRoster();
    this.world = this.freshWorld();
    this.applyBotsInvincible();
    this.resetPull();
  }

  private freezeRoster(): void {
    this.pullRoster.clear();
    for (const [playerId, ownerId] of this.slots) {
      if (ownerId) this.pullRoster.set(playerId, ownerId);
    }
    this.pullObservers.clear();
    for (const observerId of this.observers) this.pullObservers.add(observerId);
  }

  private leavePull(participantId: string): boolean {
    let changed = this.pullObservers.delete(participantId);
    for (const [playerId, ownerId] of this.pullRoster) {
      if (ownerId !== participantId) continue;
      this.pullRoster.delete(playerId);
      this.latestIntents.delete(playerId);
      changed = true;
    }
    if (changed) this.applySlotControlsToWorld();
    return changed;
  }

  private pullIsLive(): boolean {
    return this.phase === "raid" && (this.playback === "playing" || this.playback === "paused");
  }

  private pullIsAbandoned(): boolean {
    for (const ownerId of this.pullRoster.values()) {
      if (this.connections.has(ownerId)) return false;
    }
    for (const observerId of this.pullObservers) {
      if (this.connections.has(observerId)) return false;
    }
    return true;
  }

  private endRaidToWorkshop(reason: TransitionReason | null, exclude?: string): void {
    this.relay.stop();
    this.closePullLog();
    this.phase = "workshop";
    this.loadPull(EMPTY_RAID_ID, this.workshopRaid, "playing");
    this.relay.start();

    if (reason) this.broadcastAll({ type: "transition", phase: "workshop", reason });
    this.broadcastLobby();
    this.broadcastStarted(exclude);
    this.broadcastPlayback();
    logger.info("session", "raid ended to workshop", { session: this.id, reason });
  }

  private resetPull(): void {
    this.pullSnapshot.reset();
    this.relay.reset(this.world.duration, this.phase === "workshop" ? 0 : undefined);
    this.desync.reset();
  }

  private openPullLog(): void {
    this.closePullLog();
    if (this.phase !== "raid") return;
    this.pullNumber++;
    this.sessionLog = this.createSessionLog?.(`${this.id}-pull-${this.pullNumber}`) ?? null;
    this.sessionLog?.header(this.raidId, this.world);
  }

  private closePullLog(): void {
    this.sessionLog?.close();
    this.sessionLog = null;
  }

  private acceptSnapshot(participantId: string, formatVersion: number, tick: number, world: unknown): void {
    if (participantId !== this.hostParticipantId) return;
    const error = this.pullSnapshot.accept(formatVersion, tick, world, this.inputLog.length, this.playback === "playing");
    if (error) this.sendError(participantId, error);
  }

  private startedMessage(playerId: string | null): ServerMessage {
    return this.pullSnapshot.startedMessage(this.world, this.inputLog, playerId);
  }

  simEnded(participantId: string, tick: number): void {
    if (participantId !== this.hostParticipantId) {
      this.sendError(participantId, "Only the host can end the session");
      return;
    }
    if (this.playback !== "playing") return;
    this.relay.flush();
    this.playback = "done";
    this.relay.stop();
    this.closePullLog();
    this.broadcastPlayback();
    logger.info("session", "sim ended", { session: this.id, raid: this.raidId, tick, ticks: this.inputLog.length });
  }

  private endPullDefensively(): void {
    this.relay.flush();
    this.playback = "done";
    this.relay.stop();
    this.closePullLog();
    this.broadcastPlayback();
    if (this.phase === "workshop") {
      logger.info("session", "workshop reached its duration", { session: this.id, ticks: this.inputLog.length });
    } else {
      logger.warn("session", "pull hit tick ceiling without simEnded", { session: this.id, ticks: this.inputLog.length });
    }
  }

  reportWorldHash(participantId: string, tick: number, hash: number): void {
    this.desync.report(participantId, tick, hash, participantId === this.hostParticipantId);
  }

  private resync(participantId: string): void {
    if (this.pullObservers.has(participantId)) {
      this.sendTo(participantId, this.startedMessage(null));
      return;
    }
    const playerId = this.rosterPlayerFor(participantId);
    if (playerId) this.sendTo(participantId, this.startedMessage(playerId));
  }

  isExpired(now = this.now()): boolean {
    if (this.playback === "playing") return false;
    const timeout = this.isUnusedSetup() ? Math.min(EMPTY_LOBBY_TIMEOUT_MS, this.lobbyTimeoutMs) : this.lobbyTimeoutMs;
    return now - this.lastActivity >= timeout;
  }

  private isUnusedSetup(): boolean {
    return this.phase === "setup" && ![...this.slots.values()].some(owner => owner !== null);
  }

  dispose(): void {
    this.relay.stop();
    this.closePullLog();
  }

  touch(): void {
    this.lastActivity = this.now();
  }

  private playerForParticipant(participantId: string): string | null {
    for (const [playerId, ownerId] of this.slots) {
      if (ownerId === participantId) return playerId;
    }
    return null;
  }

  private rosterPlayerFor(participantId: string): string | null {
    for (const [playerId, ownerId] of this.pullRoster) {
      if (ownerId === participantId) return playerId;
    }
    return null;
  }

  private freshWorld(): World {
    let seed = makeSeed();
    if (seed === this.lastSeed) seed = (seed + 1) >>> 0;
    this.lastSeed = seed;
    const world = createWorld(this.raid, seed, this.rngConstraints);
    const waymarkPreset = this.waymarkPresetId ? WAYMARK_PRESETS.find(preset => preset.id === this.waymarkPresetId) : null;
    return {
      ...world,
      botsInvisible: this.botsInvisible,
      waymarks: waymarkPreset ? waymarkPreset.marks : world.waymarks,
      players: world.players.map(player => ({
        ...player,
        control: this.pullRoster.has(player.id) ? "human" : "bot",
      })),
    };
  }

  private applySlotControlsToWorld(): void {
    this.world = {
      ...this.world,
      players: this.world.players.map(player => {
        const control = this.pullRoster.has(player.id) ? "human" : "bot";
        return {
          ...player,
          control,
          cooldownsDisabled: control === player.control ? player.cooldownsDisabled : false,
          invincible: control === "bot" ? this.botsInvincible : player.control === "bot" ? false : player.invincible,
        };
      }),
    };
  }

  private applyBotsInvincible(): void {
    this.world = {
      ...this.world,
      players: this.world.players.map(player => (
        player.control === "bot" ? { ...player, invincible: this.botsInvincible } : player
      )),
    };
  }

  private lobbyFor(participantId: string): ServerMessage {
    const slots: LobbySlot[] = this.world.players.map(player => {
      const ownerId = this.slots.get(player.id) ?? null;
      const rostered = this.pullRoster.get(player.id) === participantId;
      return {
        playerId: player.id,
        role: player.role,
        control: player.control,
        claimed: ownerId !== null,
        claimedByYou: ownerId === participantId && rostered,
        queuedByYou: ownerId === participantId && !rostered,
      };
    });

    return {
      type: "lobby",
      sessionId: this.id,
      raidId: this.raidId,
      raidName: this.raid.name,
      phase: this.phase,
      playbackState: this.playback,
      selectedRaidId: this.selectedRaidId,
      hostParticipantId: this.hostParticipantId,
      slots,
      rngConstraints: { ...this.rngConstraints },
      rngDecisions: describeDecisions(this.selectedRaid),
      waymarkPresetId: this.waymarkPresetId,
      botPatternOptions: botPatternOptionsFor(this.selectedRaid),
      botPatternId: this.botPatternId,
      botsInvincible: this.botsInvincible,
      botsInvisible: this.botsInvisible,
      observerCount: this.observers.size,
      maxObservers: MAX_OBSERVERS,
      observingByYou: this.pullObservers.has(participantId),
      observerQueuedByYou: this.observers.has(participantId) && !this.pullObservers.has(participantId),
    };
  }

  sendLobby(participantId: string): void {
    this.sendTo(participantId, this.lobbyFor(participantId));
  }

  private broadcastLobby(): void {
    for (const participantId of this.connections.keys()) this.sendLobby(participantId);
  }

  private broadcastPlayback(): void {
    this.broadcastAll({ type: "playback", state: this.playback, phase: this.phase, raidId: this.raidId, hostParticipantId: this.hostParticipantId, rngDecisions: describeDecisions(this.selectedRaid) });
  }

  private broadcastStarted(exclude?: string): void {
    for (const participantId of this.connections.keys()) {
      if (participantId === exclude) continue;
      if (this.pullObservers.has(participantId)) {
        this.sendTo(participantId, this.startedMessage(null));
        continue;
      }
      const playerId = this.rosterPlayerFor(participantId);
      if (playerId) this.sendTo(participantId, this.startedMessage(playerId));
    }
  }

  private broadcastAll(message: ServerMessage): void {
    for (const participantId of this.connections.keys()) this.sendTo(participantId, message);
  }

  private sendError(participantId: string, message: string): void {
    logger.warn("session", "rejected", { session: this.id, participantId, reason: message });
    this.sendTo(participantId, { type: "error", message });
  }
}
