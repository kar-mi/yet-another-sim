import { createWorld } from "../engine/world";
import type { RaidDef } from "../engine/raidSchema";
import { EMPTY_RAID_ID, MAX_OBSERVERS, type BotPatternOption, type ClientMessage, type Frame, type LobbySlot, type LobbyStatus, type ServerMessage } from "@shared/protocol";
import type { Intent, Intents, World } from "@shared/types";
import { RAID_CHANGE_START_DELAY_MS } from "@shared/constants";
import { logger } from "@shared/logger";
import { WAYMARK_PRESETS, isWaymarkPresetId } from "@shared/waymarkPresets";
import { describeDecisions, findSeed } from "../engine/seedSearch";
import { DesyncTracker } from "./desyncTracker";
import { FrameRelay } from "./frameRelay";
import { mergePendingIntent, type SessionLog } from "./sessionRaid";
import { SNAPSHOT_FORMAT_VERSION } from "@shared/replay";

function botPatternOptionsFor(raid: RaidDef): BotPatternOption[] {
  if (raid.botPatternOptions) return raid.botPatternOptions.map(option => ({ id: option.id, name: option.name }));
  if (raid.botPatterns) return [{ id: "default", name: "Default" }];
  return [];
}

function defaultBotPatternId(raid: RaidDef): string | null {
  return botPatternOptionsFor(raid)[0]?.id ?? null;
}

export const LOBBY_TIMEOUT_MS = 10 * 60 * 1000;
export const EMPTY_LOBBY_TIMEOUT_MS = 90 * 1000;

export type SessionStatus = LobbyStatus;

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

// Outbound sink: routes a server message to one client. The Colyseus adapter wires this to the
// socket; tests inject their own delivery.
type Send = (clientId: string, message: ServerMessage | string) => void;
const idleIntent: Intent = { move: { x: 0, z: 0 } };

// Transport-agnostic relay: owns lobby/pull state and the authoritative input log, and emits server
// messages through the injected `send` sink. The colyseus integration lives in RelayServerRoom.
export class RelayRoom {
  id = "";
  raidId = "";
  readonly slots = new Map<string, string | null>();
  readonly observers = new Set<string>();
  status: SessionStatus = "lobby";
  hostClientId = "";
  raidRequestSeq = 0;
  // The pull's initial (tick-0) world. The server never ticks it — clients run the engine. It is
  // sent on `started` so a fresh/late client can rebuild the world by replaying the input log.
  world!: World;

  private raid!: RaidDef;
  private readonly clientIds = new Set<string>();
  private send!: Send;
  private readonly latestIntents = new Map<string, Intent>();
  private now: () => number = Date.now;
  private lastActivity = 0;
  private lobbyTimeoutMs = LOBBY_TIMEOUT_MS;
  private relay!: FrameRelay;
  private autoTick = true;
  // Deferred relay start scheduled on a raid change (see RAID_CHANGE_START_DELAY_MS). Cancelled by any
  // other pull transition so a stale start can't fire late (e.g. after dispose, leaking an interval).
  private pendingStartTimer: ReturnType<typeof setTimeout> | null = null;
  private desync!: DesyncTracker;
  private createSessionLog: ((sessionId: string) => SessionLog) | null = null;
  private sessionLog: SessionLog | null = null;
  private pullNumber = 0;
  private botsInvincible = false;
  private latestSnapshot: { formatVersion: number; tick: number; world: unknown } | null = null;
  private seedOverride: number | null = null;
  private waymarkPresetId: string | null = null;
  private botPatternId: string | null = null;

  // Authoritative input log: one merged-intent Frame per simulated tick since the pull started.
  // Owned by the relay; exposed for late-join / resync (`started` sends it in full to be replayed).
  get inputLog(): Frame[] {
    return this.relay.inputLog;
  }

  init(options: RelayRoomInitOptions & { send: Send }): void {
    this.send = options.send;
    this.id = options.id;
    this.raidId = options.raidId;
    this.raid = options.raid;
    this.botPatternId = defaultBotPatternId(this.raid);
    this.now = options.now ?? Date.now;
    this.lobbyTimeoutMs = options.lobbyTimeoutMs ?? LOBBY_TIMEOUT_MS;
    this.createSessionLog = options.createSessionLog ?? null;
    this.lastActivity = this.now();
    this.desync = new DesyncTracker({ sessionId: this.id, now: this.now, onDesync: clientId => this.resync(clientId) });
    this.autoTick = options.autoTick ?? true;
    this.relay = new FrameRelay({
      now: this.now,
      autoTick: this.autoTick,
      sessionLog: () => this.sessionLog,
      buildFrame: () => this.buildFrame(),
      onFrames: (startTick, frames) => this.broadcastAll({ type: "frames", startTick, frames }),
      onCeiling: () => this.endPullDefensively(),
      isRunning: () => this.status === "running",
    });

    for (const player of this.raid.players) this.slots.set(player.id, null);
    this.world = this.freshWorld();
    this.resetPull();
  }

  private sendTo(clientId: string, message: ServerMessage | string): void {
    this.send(clientId, message);
  }

  join(clientId: string): void {
    this.touch();
    this.clientIds.add(clientId);
    if (!this.hostClientId) this.hostClientId = clientId;
    this.sendLobby(clientId);
    logger.info("session", "client joined", { session: this.id, clientId, clients: this.clientIds.size });
  }

  handle(clientId: string, message: Exclude<ClientMessage, { type: "join" | "setRaid" | "setBotPattern" }>): void {
    this.touch();
    switch (message.type) {
      case "claimSlot":
        this.claimSlot(clientId, message.playerId);
        return;
      case "releaseSlot":
        this.releaseSlot(clientId, message.playerId);
        return;
      case "claimObserver":
        this.claimObserver(clientId);
        return;
      case "releaseObserver":
        this.releaseObserver(clientId);
        return;
      case "start":
        this.start(clientId);
        return;
      case "play":
        this.play(clientId);
        return;
      case "pause":
        this.pause(clientId);
        return;
      case "stop":
        this.stop(clientId);
        return;
      case "leave":
        this.leave(clientId);
        return;
      case "restart":
        this.restart(clientId);
        return;
      case "setSeed":
        this.setSeed(clientId, message.seed);
        return;
      case "findSeed":
        this.applyRngConstraints(clientId, message.constraints);
        return;
      case "setWaymarkPreset":
        this.setWaymarkPreset(clientId, message.presetId);
        return;
      case "setBotsInvincible":
        this.setBotsInvincible(clientId, message.enabled);
        return;
      case "intent":
        this.setIntent(clientId, message.intent);
        return;
      case "simEnded":
        this.simEnded(clientId, message.tick);
        return;
      case "worldHash":
        this.reportWorldHash(clientId, message.tick, message.hash);
        return;
      case "snapshot":
        this.acceptSnapshot(clientId, message.formatVersion, message.tick, message.world);
        return;
    }
  }

  setRaid(clientId: string, raidId: string, raid: RaidDef): void {
    this.touch();
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can change the raid");
      return;
    }
    if (this.status === "running") {
      this.sendError(clientId, "Stop or pause before changing raid");
      return;
    }
    if (raidId === this.raidId) return;

    const preserveOwners = this.status !== "lobby";
    const previousSlots = new Map(this.slots);
    const previousOwners = preserveOwners
      ? [...previousSlots.values()].filter((ownerId): ownerId is string => ownerId !== null)
      : [];
    this.raidId = raidId;
    this.raid = raid;
    this.seedOverride = null;
    this.waymarkPresetId = null;
    this.botPatternId = defaultBotPatternId(this.raid);
    this.closePullLog();
    this.slots.clear();
    for (const player of this.raid.players) this.slots.set(player.id, preserveOwners ? previousSlots.get(player.id) ?? null : null);
    const keptOwners = new Set([...this.slots.values()].filter((ownerId): ownerId is string => ownerId !== null));
    const displacedOwners = previousOwners.filter(ownerId => !keptOwners.has(ownerId));
    for (const ownerId of displacedOwners) {
      const openPlayer = this.raid.players.find(player => this.slots.get(player.id) === null);
      if (!openPlayer) break;
      this.slots.set(openPlayer.id, ownerId);
    }
    this.latestIntents.clear();
    this.world = this.freshWorld();
    this.applyBotsInvincible();
    this.resetPull();
    if (this.status === "lobby") {
      this.broadcastLobby();
      return;
    }

    this.status = "running";
    this.openPullLog();
    this.startRelayAfterRaidChangeDelay();
    this.broadcastPlayback();
    this.broadcastStarted();
    logger.info("session", "raid changed", { session: this.id, raid: this.raidId });
  }

  // Begin the relay tick loop after the client's raid-change loading overlay, so the timeline doesn't
  // advance behind it. Synchronous when autoTick is off (tests) to keep manual stepping deterministic.
  private startRelayAfterRaidChangeDelay(): void {
    this.clearPendingStart();
    if (!this.autoTick) {
      this.relay.start();
      return;
    }
    this.pendingStartTimer = setTimeout(() => {
      this.pendingStartTimer = null;
      if (this.status === "running") this.relay.start();
    }, RAID_CHANGE_START_DELAY_MS);
  }

  private clearPendingStart(): void {
    if (!this.pendingStartTimer) return;
    clearTimeout(this.pendingStartTimer);
    this.pendingStartTimer = null;
  }

  play(clientId: string): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can play");
      return;
    }
    if (this.status === "lobby") {
      this.start(clientId);
      return;
    }
    if (this.status === "running") return;
    if (this.status === "done") {
      this.sendError(clientId, "Cannot play after session ends");
      return;
    }

    const wasStopped = this.status === "stopped";
    // Clients resume stepping from the frames that follow; the local world held while paused.
    this.status = "running";
    this.relay.start();
    if (wasStopped) {
      // Refresh clients still on the lobby screen before "started", so their stale lastLobby.status
      // ("stopped") doesn't get read as the initial playback state for the resumed session.
      this.broadcastLobby();
      this.broadcastStarted();
    }
    this.broadcastPlayback();
    logger.info("session", "resumed", { session: this.id, raid: this.raidId });
  }

  pause(clientId: string): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can pause");
      return;
    }
    if (this.status !== "running") return;

    this.clearPendingStart();
    this.relay.flush(); // deliver everything up to the pause point before halting the relay
    this.status = "paused";
    this.relay.stop();
    this.broadcastPlayback();
    logger.info("session", "paused", { session: this.id, raid: this.raidId });
  }

  stop(clientId: string): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can stop");
      return;
    }
    if (this.status === "lobby") return;

    this.clearPendingStart();
    this.status = "stopped";
    this.relay.stop();
    this.closePullLog();
    this.latestIntents.clear();
    this.world = this.freshWorld();
    this.applyBotsInvincible();
    this.resetPull();
    // Reset every client's local world to the fresh (frozen) one, then signal the stopped state.
    this.broadcastStarted();
    this.broadcastPlayback();
    logger.info("session", "raid stopped", { session: this.id, raid: this.raidId });
  }

  // Host returning to the lobby via Home. Stops the pull (so the session is joinable again) exactly
  // like stop(), except the leaving host is NOT sent a "started" message: it is headed to the lobby,
  // where showLobby treats any "started" as a re-entry and would bounce it back into a stale sim.
  leave(clientId: string): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can leave to the lobby");
      return;
    }
    if (this.status === "lobby") return;

    this.clearPendingStart();
    this.status = "stopped";
    this.relay.stop();
    this.closePullLog();
    this.latestIntents.clear();
    this.world = this.freshWorld();
    this.applyBotsInvincible();
    this.resetPull();

    // Reset the remaining clients' local worlds to the frozen one (as stop() does); the leaver is
    // skipped and instead receives the lobby broadcast below to land back in the menu.
    for (const id of this.clientIds) {
      if (id === clientId) continue;
      if (this.observers.has(id)) {
        this.sendTo(id, this.startedMessage(null));
        continue;
      }
      const playerId = this.playerForClient(id);
      if (playerId) this.sendTo(id, this.startedMessage(playerId));
    }
    this.broadcastPlayback();
    this.broadcastLobby();
    logger.info("session", "host returned to lobby", { session: this.id, raid: this.raidId });
  }

  restart(clientId: string): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can restart");
      return;
    }
    if (this.status === "lobby") {
      this.start(clientId);
      return;
    }

    this.clearPendingStart();
    this.status = "running";
    this.latestIntents.clear();
    this.world = this.freshWorld();
    this.applyBotsInvincible();
    this.resetPull();
    this.openPullLog();
    this.relay.start();
    this.broadcastPlayback();
    // Refresh clients still on the lobby screen before "started", so their stale lastLobby.status
    // (e.g. "done") doesn't get read as the initial playback state for the restarted session.
    this.broadcastLobby();
    this.broadcastStarted();
    logger.info("session", "raid restarted", { session: this.id, raid: this.raidId });
  }

  disconnectClient(clientId: string): boolean {
    this.touch();
    this.clientIds.delete(clientId);
    logger.info("session", "client disconnected", { session: this.id, clientId, clients: this.clientIds.size });

    for (const [playerId, ownerId] of this.slots) {
      if (ownerId === clientId) {
        this.slots.set(playerId, null);
        this.latestIntents.delete(playerId);
      }
    }
    this.observers.delete(clientId);

    const hostChanged = this.hostClientId === clientId;
    if (hostChanged) {
      this.hostClientId = this.clientIds.values().next().value ?? "";
    }

    this.applySlotControlsToWorld();
    if (this.clientIds.size === 0) {
      this.dispose();
      return true;
    }

    this.broadcastLobby();
    if (hostChanged && this.status !== "lobby") this.broadcastPlayback();
    return false;
  }

  claimSlot(clientId: string, playerId: string): void {
    if (this.raidId !== EMPTY_RAID_ID && (this.status === "running" || this.status === "paused")) {
      this.sendError(clientId, "Wait for the next pull to join");
      return;
    }
    if (!this.slots.has(playerId)) {
      this.sendError(clientId, "Unknown player slot");
      return;
    }
    if (this.observers.has(clientId)) {
      this.sendError(clientId, "Leave observer mode before claiming a slot");
      return;
    }

    const ownedSlot = this.playerForClient(clientId);
    if (ownedSlot && ownedSlot !== playerId) {
      this.sendError(clientId, "You already claimed a slot");
      return;
    }

    const ownerId = this.slots.get(playerId);
    if (ownerId && ownerId !== clientId) {
      this.sendError(clientId, "Slot is already claimed");
      return;
    }

    this.slots.set(playerId, clientId);
    this.applySlotControlsToWorld();
    this.broadcastLobby();

    if (this.raidId === EMPTY_RAID_ID && (this.status === "running" || this.status === "paused")) {
      this.sendTo(clientId, this.startedMessage(playerId));
    }
  }

  releaseSlot(clientId: string, playerId: string): void {
    if (this.slots.get(playerId) !== clientId) {
      this.sendError(clientId, "You do not own that slot");
      return;
    }

    this.slots.set(playerId, null);
    this.latestIntents.delete(playerId);
    this.applySlotControlsToWorld();
    this.broadcastLobby();
  }

  claimObserver(clientId: string): void {
    if (this.raidId !== EMPTY_RAID_ID && (this.status === "running" || this.status === "paused")) {
      this.sendError(clientId, "Wait for the next pull to join");
      return;
    }
    if (this.playerForClient(clientId)) {
      this.sendError(clientId, "Release your slot before observing");
      return;
    }
    if (this.observers.has(clientId)) {
      this.sendLobby(clientId);
      return;
    }
    if (this.observers.size >= MAX_OBSERVERS) {
      this.sendError(clientId, "Observer seats are full");
      return;
    }

    this.observers.add(clientId);
    this.broadcastLobby();

    if (this.raidId === EMPTY_RAID_ID && (this.status === "running" || this.status === "paused")) {
      this.sendTo(clientId, this.startedMessage(null));
    }
  }

  releaseObserver(clientId: string): void {
    // Release is intentionally idempotent: a double-click or a stale Home cleanup can race the
    // lobby broadcast that confirms the first release, and there is no state left to correct.
    if (!this.observers.delete(clientId)) return;
    this.broadcastLobby();
  }

  start(clientId: string): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can start");
      return;
    }
    if (this.status !== "lobby") {
      this.sendError(clientId, "Session already started");
      return;
    }
    if (![...this.slots.values()].some(ownerId => ownerId !== null) && !this.observers.has(clientId)) {
      this.sendError(clientId, "Claim a slot or observer seat before starting");
      return;
    }

    this.status = "running";
    this.world = this.freshWorld();
    this.applyBotsInvincible();
    this.resetPull();
    this.openPullLog();

    this.broadcastStarted();

    this.relay.start();
    logger.info("session", "raid started", { session: this.id, raid: this.raidId });
  }

  setIntent(clientId: string, intent: Intent): void {
    if (this.status !== "running") return;
    const playerId = this.playerForClient(clientId);
    if (!playerId) return;
    this.latestIntents.set(playerId, mergePendingIntent(this.latestIntents.get(playerId), intent));
  }

  setBotsInvincible(clientId: string, enabled: boolean): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can change bot invincibility");
      return;
    }

    // Bot invincibility rides in every frame; clients apply it deterministically as they step, so
    // the change takes effect on the next relayed tick. `this.world` keeps it for late-join display.
    this.botsInvincible = enabled;
    this.applyBotsInvincible();
  }

  setSeed(clientId: string, seed: number | null): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can set the seed");
      return;
    }

    this.seedOverride = seed;
    this.broadcastLobby();
  }

  setWaymarkPreset(clientId: string, presetId: string | null): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can set the waymark preset");
      return;
    }
    if (presetId !== null && !isWaymarkPresetId(presetId)) {
      this.sendError(clientId, "Unknown waymark preset");
      return;
    }

    this.waymarkPresetId = presetId;
    this.refreshFrozenWorld();
    this.broadcastLobby();
  }

  // Called by RelayServerRoom after it has asynchronously re-resolved the raid with the chosen
  // bot-pattern file applied (bot patterns are baked into RaidDef at file-load time, unlike the
  // seed/waymark overrides, which apply lazily at freshWorld()).
  setBotPattern(clientId: string, patternId: string, raid: RaidDef): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can set the bot pattern");
      return;
    }

    this.raid = raid;
    this.botPatternId = patternId;
    this.refreshFrozenWorld();
    this.broadcastLobby();
  }

  // The client stops the pull before opening the Options modal, so a waymark/bot-pattern change
  // normally lands while idle (paused/stopped/done) rather than mid-pull. Rebuild the frozen world
  // right away so the change is visible immediately instead of waiting for the next start/restart.
  // No-op in "lobby" (nothing shown yet) and "running" (never applied mid-pull).
  private refreshFrozenWorld(): void {
    if (this.status === "lobby" || this.status === "running") return;
    this.world = this.freshWorld();
    this.applyBotsInvincible();
    this.resetPull();
    this.broadcastStarted();
  }

  private applyRngConstraints(clientId: string, constraints: Record<string, number>): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can set the seed");
      return;
    }
    if (Object.keys(constraints).length === 0) {
      this.sendTo(clientId, { type: "rngResult", ok: false });
      return;
    }
    const seed = findSeed(this.raid, constraints);
    if (seed === null) {
      this.sendTo(clientId, { type: "rngResult", ok: false });
      return;
    }
    this.seedOverride = seed;
    this.sendTo(clientId, { type: "rngResult", ok: true });
    this.broadcastLobby();
  }

  // Advance the relay by one tick (produce a frame, broadcast unless batching). The server never runs
  // `tick()`; clients do. Frame production/relay lives in FrameRelay.
  step(broadcast = true): void {
    if (this.status !== "running") return;
    this.relay.produceFrame();
    if (broadcast) this.relay.flush();
  }

  // Merge each owned slot's latest intent into this tick's frame: move + facing carry forward between
  // ticks; one-shot actions (jump/sprint/provoke/…) fire once. Injected into FrameRelay.buildFrame.
  private buildFrame(): Frame {
    const intents: Intents = {};
    for (const [playerId, ownerId] of this.slots) {
      if (!ownerId) continue;
      const latestIntent = this.latestIntents.get(playerId) ?? idleIntent;
      intents[playerId] = latestIntent;
      this.latestIntents.set(playerId, { move: latestIntent.move, facing: latestIntent.facing });
    }
    return { intents, botsInvincible: this.botsInvincible };
  }

  // Reset per-pull state whenever a fresh tick-0 world is built (start/restart/stop/setRaid) so the
  // input log, batching, and desync window start clean.
  private resetPull(): void {
    this.latestSnapshot = null;
    this.relay.reset(this.world.duration);
    this.desync.reset();
  }

  private openPullLog(): void {
    this.closePullLog();
    this.pullNumber++;
    this.sessionLog = this.createSessionLog?.(`${this.id}-pull-${this.pullNumber}`) ?? null;
    this.sessionLog?.header(this.raidId, this.world);
  }

  private closePullLog(): void {
    this.sessionLog?.close();
    this.sessionLog = null;
  }

  private acceptSnapshot(clientId: string, formatVersion: number, tick: number, world: unknown): void {
    if (clientId !== this.hostClientId) return;
    if (formatVersion !== SNAPSHOT_FORMAT_VERSION) {
      this.sendError(clientId, `Unsupported snapshot format ${formatVersion}; expected ${SNAPSHOT_FORMAT_VERSION}`);
      return;
    }
    if (this.status !== "running") return;
    if (tick > this.inputLog.length) return;
    if (this.latestSnapshot && tick <= this.latestSnapshot.tick) return;
    // Shallow shape guard: the world is stored opaquely (the host is trusted), but a malformed
    // snapshot would poison every later join/resync (the client crashes rehydrating it). Reject it
    // so startedMessage falls back to full-log anchoring.
    if (!world || typeof world !== "object" || !("arena" in world) || !("players" in world)) return;
    this.latestSnapshot = { formatVersion, tick, world };
  }

  private startedMessage(playerId: string | null): ServerMessage {
    const snap = this.latestSnapshot;
    if (snap) {
      return { type: "started", world: snap.world as World, baseTick: snap.tick,
               yourPlayerId: playerId, tick: this.inputLog.length, frames: this.inputLog.slice(snap.tick) };
    }
    return { type: "started", world: this.world, baseTick: 0,
             yourPlayerId: playerId, tick: this.inputLog.length, frames: this.inputLog };
  }

  // The host's local sim reached a terminal state (wiped/cleared). Stop relaying and mark the pull
  // done — equivalent authority to the host's `stop`, which it can already do at any time.
  simEnded(clientId: string, tick: number): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can end the session");
      return;
    }
    if (this.status !== "running") return;
    this.relay.flush();
    this.status = "done";
    this.relay.stop();
    this.closePullLog();
    this.broadcastPlayback();
    logger.info("session", "sim ended", { session: this.id, raid: this.raidId, tick, ticks: this.inputLog.length });
  }

  // Defensive: a host that never sends `simEnded` would otherwise have the room relay idle frames
  // forever (running sessions never expire). Cap the pull well past its duration and finish it.
  private endPullDefensively(): void {
    this.relay.flush();
    this.status = "done";
    this.relay.stop();
    this.closePullLog();
    this.broadcastPlayback();
    logger.warn("session", "pull hit tick ceiling without simEnded", { session: this.id, ticks: this.inputLog.length });
  }

  // Desync detection is delegated to DesyncTracker; a flagged divergence resyncs the offender here.
  reportWorldHash(clientId: string, tick: number, hash: number): void {
    this.desync.report(clientId, tick, hash, clientId === this.hostClientId);
  }

  private resync(clientId: string): void {
    if (this.observers.has(clientId)) {
      this.sendTo(clientId, this.startedMessage(null));
      return;
    }
    const playerId = this.playerForClient(clientId);
    if (playerId) this.sendTo(clientId, this.startedMessage(playerId));
  }

  isExpired(now = this.now()): boolean {
    if (this.status === "running") return false;
    const timeout = this.isUnusedLobby() ? Math.min(EMPTY_LOBBY_TIMEOUT_MS, this.lobbyTimeoutMs) : this.lobbyTimeoutMs;
    return now - this.lastActivity >= timeout;
  }

  // A never-started lobby with no slot claimed — the cheap artifact a mass-create
  // flood leaves behind. Once a slot is claimed or the raid starts, it is "in use".
  private isUnusedLobby(): boolean {
    return this.status === "lobby" && ![...this.slots.values()].some(owner => owner !== null);
  }

  dispose(): void {
    this.clearPendingStart();
    this.relay.stop();
    this.closePullLog();
  }

  touch(): void {
    this.lastActivity = this.now();
  }

  private playerForClient(clientId: string): string | null {
    for (const [playerId, ownerId] of this.slots) {
      if (ownerId === clientId) return playerId;
    }
    return null;
  }

  // Build a fresh world from the raid and stamp each slot's current control (a slot is "human"
  // once a client owns it, otherwise "bot"). Raids no longer author control — it is purely a
  // function of slot ownership.
  private freshWorld(): World {
    const world = createWorld(this.raid, this.seedOverride ?? undefined);
    const waymarkPreset = this.waymarkPresetId ? WAYMARK_PRESETS.find(preset => preset.id === this.waymarkPresetId) : null;
    return {
      ...world,
      waymarks: waymarkPreset ? waymarkPreset.marks : world.waymarks,
      players: world.players.map(player => ({
        ...player,
        control: this.slots.get(player.id) ? "human" : "bot",
      })),
    };
  }

  private applySlotControlsToWorld(): void {
    const controlByPlayer = new Map<string, "human" | "bot">();
    for (const [playerId, ownerId] of this.slots) {
      controlByPlayer.set(playerId, ownerId ? "human" : "bot");
    }

    this.world = {
      ...this.world,
      players: this.world.players.map(player => {
        const control = controlByPlayer.get(player.id) ?? player.control;
        return {
          ...player,
          control,
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

  private lobbyFor(clientId: string): ServerMessage {
    const slots: LobbySlot[] = this.world.players.map(player => {
      const ownerId = this.slots.get(player.id) ?? null;
      return {
        playerId: player.id,
        role: player.role,
        control: player.control,
        claimed: ownerId !== null,
        claimedByYou: ownerId === clientId,
      };
    });

    return {
      type: "lobby",
      sessionId: this.id,
      raidId: this.raidId,
      raidName: this.raid.name,
      status: this.status,
      hostClientId: this.hostClientId,
      slots,
      seedOverride: this.seedOverride,
      rngDecisions: describeDecisions(this.raid),
      waymarkPresetId: this.waymarkPresetId,
      botPatternOptions: botPatternOptionsFor(this.raid),
      botPatternId: this.botPatternId,
      observerCount: this.observers.size,
      maxObservers: MAX_OBSERVERS,
      observingByYou: this.observers.has(clientId),
    };
  }

  sendLobby(clientId: string): void {
    this.sendTo(clientId, this.lobbyFor(clientId));
  }

  private broadcastLobby(): void {
    for (const clientId of this.clientIds) this.sendLobby(clientId);
  }

  private broadcastPlayback(): void {
    const state = this.status === "running" ? "playing" : this.status === "paused" ? "paused" : this.status === "done" ? "done" : "stopped";
    this.broadcastAll({ type: "playback", state, raidId: this.raidId, hostClientId: this.hostClientId, rngDecisions: describeDecisions(this.raid) });
  }

  private broadcastStarted(): void {
    for (const connectedClientId of this.clientIds) {
      if (this.observers.has(connectedClientId)) {
        this.sendTo(connectedClientId, this.startedMessage(null));
        continue;
      }
      const playerId = this.playerForClient(connectedClientId);
      if (!playerId) {
        this.sendError(connectedClientId, "Claim a slot to join the running session");
        continue;
      }
      this.sendTo(connectedClientId, this.startedMessage(playerId));
    }
  }

  private broadcastAll(message: ServerMessage): void {
    const json = JSON.stringify(message);
    for (const clientId of this.clientIds) this.sendTo(clientId, json);
  }

  private sendError(clientId: string, message: string): void {
    logger.warn("session", "rejected", { session: this.id, clientId, reason: message });
    this.sendTo(clientId, { type: "error", message });
  }
}
