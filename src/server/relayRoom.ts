import { Room, type AuthContext, type Client } from "colyseus";
import { createWorld } from "../engine/world";
import type { RaidDef } from "../engine/raidSchema";
import { ClientMessageSchema, EMPTY_RAID_ID, MAX_OBSERVERS, type ClientMessage, type Frame, type LobbySlot, type LobbyStatus, type ServerMessage } from "@shared/protocol";
import type { Intent, Intents, World } from "@shared/types";
import { RAID_CHANGE_START_DELAY_MS } from "@shared/constants";
import { logger, createSessionLog } from "./logger";
import { DesyncTracker } from "./desyncTracker";
import { FrameRelay } from "./frameRelay";
import { RAIDS_DIR } from "./raidCatalog";
import { isOriginAllowed, parseAllowedOrigins } from "./origin";
import { ConnectionCounter, clientIpFor, createMessageRateLimiter, type RateLimiter } from "./rateLimit";
import { addServerTraceEvent, recordServerException, withServerSpan } from "./otel";
import { loadSessionRaid, mergePendingIntent, type SessionLog } from "./sessionRaid";

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

function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be positive integer`);
  return value;
}

export const MAX_SESSIONS = parsePositiveInt("MAX_SESSIONS", Bun.env.MAX_SESSIONS, 10);
export const MAX_CONNECTIONS_PER_IP = parsePositiveInt("MAX_CONNECTIONS_PER_IP", Bun.env.MAX_CONNECTIONS_PER_IP, 30);
export const MAX_WS_MSGS_PER_SEC = parsePositiveInt("MAX_WS_MSGS_PER_SEC", Bun.env.MAX_WS_MSGS_PER_SEC, 120);

const ALLOWED_ORIGINS = parseAllowedOrigins(Bun.env.ALLOWED_ORIGINS);
const ipConnections = new ConnectionCounter(MAX_CONNECTIONS_PER_IP);
let connectedClients = 0;
let activeRooms = 0;

export function relayClientsConnected(): number {
  return connectedClients;
}

export function relayRoomsActive(): number {
  return activeRooms;
}

interface RelayClientData {
  ip?: string;
  rate?: RateLimiter;
}

interface RelayRoomInitOptions {
  id: string;
  raidId: string;
  raid: RaidDef;
  now?: () => number;
  autoTick?: boolean;
  lobbyTimeoutMs?: number;
  createSessionLog?: (sessionId: string) => SessionLog;
}

type TestSend = (clientId: string, message: ServerMessage | string) => void;
const idleIntent: Intent = { move: { x: 0, z: 0 } };

export interface RelayRoomOptions {
  sessionId?: string;
  raidId?: string;
  autoTick?: boolean;
  now?: () => number;
  lobbyTimeoutMs?: number;
}

export class RelayRoom extends Room {
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
  private testSend: TestSend | null = null;
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
  private sessionLog: SessionLog | null = null;
  private botsInvincible = false;
  private latestSnapshot: { tick: number; world: unknown } | null = null;

  // Authoritative input log: one merged-intent Frame per simulated tick since the pull started.
  // Owned by the relay; exposed for late-join / resync (`started` sends it in full to be replayed).
  get inputLog(): Frame[] {
    return this.relay.inputLog;
  }

  private initSession(options: RelayRoomInitOptions): void {
    this.id = options.id;
    this.raidId = options.raidId;
    this.raid = options.raid;
    this.now = options.now ?? Date.now;
    this.lobbyTimeoutMs = options.lobbyTimeoutMs ?? LOBBY_TIMEOUT_MS;
    this.sessionLog = options.createSessionLog?.(options.id) ?? null;
    this.lastActivity = this.now();
    this.desync = new DesyncTracker({ sessionId: this.id, now: this.now, onDesync: clientId => this.resync(clientId) });
    this.autoTick = options.autoTick ?? true;
    this.relay = new FrameRelay({
      now: this.now,
      autoTick: this.autoTick,
      sessionLog: this.sessionLog,
      buildFrame: () => this.buildFrame(),
      onFrames: (startTick, frames) => this.broadcastAll({ type: "frames", startTick, frames }),
      onCeiling: () => this.endPullDefensively(),
      isRunning: () => this.status === "running",
    });

    for (const player of this.raid.players) this.slots.set(player.id, null);
    this.world = this.freshWorld();
    this.resetPull();
  }

  initForTest(options: RelayRoomInitOptions & { send: TestSend }): void {
    this.testSend = options.send;
    this.initSession(options);
  }

  async onCreate(options: RelayRoomOptions): Promise<void> {
    const sessionId = typeof options.sessionId === "string" && options.sessionId ? options.sessionId : this.roomId;
    const raidId = typeof options.raidId === "string" && options.raidId ? options.raidId : EMPTY_RAID_ID;
    if (activeRooms >= MAX_SESSIONS) throw new Error("Server is full");
    activeRooms++;
    await this.setMetadata({ sessionId } as any);
    this.initSession({
      id: sessionId,
      raidId,
      raid: await loadSessionRaid(raidId, RAIDS_DIR),
      autoTick: options.autoTick,
      now: options.now,
      lobbyTimeoutMs: options.lobbyTimeoutMs,
      createSessionLog,
    });
    this.onMessage("c", (client, message) => this.handleColyseusMessage(client, message));
    this.clock.setInterval(() => {
      if (!this.isExpired()) return;
      for (const client of this.clients) client.send("s", { type: "sessionExpired" } satisfies ServerMessage);
      this.disconnect();
    }, 60_000);
  }

  onAuth(client: Client<RelayClientData>, _options: RelayRoomOptions, context: AuthContext): boolean {
    const origin = context.headers.origin;
    const host = context.headers.host ?? "localhost";
    const hostValue = Array.isArray(host) ? host[0] : host;
    const requestUrl = "http://" + hostValue + "/";
    if (!isOriginAllowed(Array.isArray(origin) ? origin[0] : origin ?? null, requestUrl, ALLOWED_ORIGINS)) return false;
    const forwarded = context.headers["x-forwarded-for"];
    const ip = clientIpFor(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? null, Array.isArray(context.ip) ? context.ip[0] : context.ip);
    if (!ipConnections.tryAcquire(ip)) return false;
    client.userData = { ip, rate: createMessageRateLimiter(MAX_WS_MSGS_PER_SEC) };
    return true;
  }

  onJoin(client: Client<RelayClientData>): void {
    connectedClients++;
    client.send("s", { type: "joined", sessionId: this.id, clientId: client.sessionId } satisfies ServerMessage);
    this.join(client.sessionId);
  }

  onLeave(client: Client<RelayClientData>): void {
    connectedClients = Math.max(0, connectedClients - 1);
    if (client.userData?.ip) ipConnections.release(client.userData.ip);
    this.disconnectClient(client.sessionId);
  }

  onDispose(): void {
    activeRooms = Math.max(0, activeRooms - 1);
    this.dispose();
  }

  private handleColyseusMessage(client: Client<RelayClientData>, raw: unknown): void {
    withServerSpan("ws.message", { clientId: client.sessionId }, async span => {
      const rate = client.userData?.rate;
      if (rate && !rate.allow()) return;
      const parsed = ClientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn("net", "invalid message", { clientId: client.sessionId });
        client.send("s", { type: "error", message: "Invalid message" } satisfies ServerMessage);
        return;
      }
      if (parsed.data.type === "debugPosition") {
        logger.debug("hud", "player position", { clientId: client.sessionId, ...parsed.data });
        return;
      }
      span.setAttribute("yas.message_type", parsed.data.type);
      addServerTraceEvent("net", "WS message", { clientId: client.sessionId, type: parsed.data.type });
      try {
        if (parsed.data.type === "join") return;
        if (parsed.data.type === "setRaid") {
          this.setRaid(client.sessionId, parsed.data.raidId, await loadSessionRaid(parsed.data.raidId, RAIDS_DIR));
          return;
        }
        this.handle(client.sessionId, parsed.data);
      } catch (err) {
        recordServerException(err, { area: "ws.message", clientId: client.sessionId, type: parsed.data.type }, span);
        logger.error("net", "message handler failed", { clientId: client.sessionId, type: parsed.data.type, err });
        client.send("s", { type: "error", message: "Server error" } satisfies ServerMessage);
      }
    });
  }

  private send(clientId: string, message: ServerMessage | string): void {
    if (this.testSend) {
      this.testSend(clientId, message);
      return;
    }
    const payload = typeof message === "string" ? JSON.parse(message) as ServerMessage : message;
    this.clients.getById(clientId)?.send("s", payload);
  }

  join(clientId: string): void {
    this.touch();
    this.clientIds.add(clientId);
    if (!this.hostClientId) this.hostClientId = clientId;
    this.sendLobby(clientId);
    logger.info("session", "client joined", { session: this.id, clientId, clients: this.clientIds.size });
  }

  handle(clientId: string, message: Exclude<ClientMessage, { type: "join" | "setRaid" }>): void {
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
        this.acceptSnapshot(clientId, message.tick, message.world);
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

    // Clients resume stepping from the frames that follow; the local world held while paused.
    this.status = "running";
    this.relay.start();
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
    this.latestIntents.clear();
    this.world = this.freshWorld();
    this.applyBotsInvincible();
    this.resetPull();

    // Reset the remaining clients' local worlds to the frozen one (as stop() does); the leaver is
    // skipped and instead receives the lobby broadcast below to land back in the menu.
    for (const id of this.clientIds) {
      if (id === clientId) continue;
      if (this.observers.has(id)) {
        this.send(id, this.startedMessage(null));
        continue;
      }
      const playerId = this.playerForClient(id);
      if (playerId) this.send(id, this.startedMessage(playerId));
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
    this.relay.start();
    this.broadcastPlayback();
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

    if (this.status === "stopped" || this.status === "done" || (this.raidId === EMPTY_RAID_ID && (this.status === "running" || this.status === "paused"))) {
      this.send(clientId, this.startedMessage(playerId));
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

    if (this.status === "stopped" || this.status === "done" || (this.raidId === EMPTY_RAID_ID && (this.status === "running" || this.status === "paused"))) {
      this.send(clientId, this.startedMessage(null));
    }
  }

  releaseObserver(clientId: string): void {
    if (!this.observers.delete(clientId)) {
      this.sendError(clientId, "You are not observing");
      return;
    }
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
    // On a real pull start (start/restart set status="running" before this; the constructor's
    // lobby-time reset does not), record the tick-0 world so the session log is self-contained:
    // its seed + this header let the relayed frames be replayed without any other state.
    if (this.status === "running") this.sessionLog?.header(this.raidId, this.world);
  }

  private acceptSnapshot(clientId: string, tick: number, world: unknown): void {
    if (clientId !== this.hostClientId) return;
    if (this.status !== "running") return;
    if (tick > this.inputLog.length) return;
    if (this.latestSnapshot && tick <= this.latestSnapshot.tick) return;
    // Shallow shape guard: the world is stored opaquely (the host is trusted), but a malformed
    // snapshot would poison every later join/resync (the client crashes rehydrating it). Reject it
    // so startedMessage falls back to full-log anchoring.
    if (!world || typeof world !== "object" || !("arena" in world) || !("players" in world)) return;
    this.latestSnapshot = { tick, world };
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
    this.broadcastPlayback();
    logger.info("session", "sim ended", { session: this.id, raid: this.raidId, tick, ticks: this.inputLog.length });
  }

  // Defensive: a host that never sends `simEnded` would otherwise have the room relay idle frames
  // forever (running sessions never expire). Cap the pull well past its duration and finish it.
  private endPullDefensively(): void {
    this.relay.flush();
    this.status = "done";
    this.relay.stop();
    this.broadcastPlayback();
    logger.warn("session", "pull hit tick ceiling without simEnded", { session: this.id, ticks: this.inputLog.length });
  }

  // Desync detection is delegated to DesyncTracker; a flagged divergence resyncs the offender here.
  reportWorldHash(clientId: string, tick: number, hash: number): void {
    this.desync.report(clientId, tick, hash, clientId === this.hostClientId);
  }

  private resync(clientId: string): void {
    if (this.observers.has(clientId)) {
      this.send(clientId, this.startedMessage(null));
      return;
    }
    const playerId = this.playerForClient(clientId);
    if (playerId) this.send(clientId, this.startedMessage(playerId));
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
    this.sessionLog?.close();
  }

  private touch(): void {
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
    const world = createWorld(this.raid);
    return {
      ...world,
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
      observerCount: this.observers.size,
      maxObservers: MAX_OBSERVERS,
      observingByYou: this.observers.has(clientId),
    };
  }

  private sendLobby(clientId: string): void {
    this.send(clientId, this.lobbyFor(clientId));
  }

  private broadcastLobby(): void {
    for (const clientId of this.clientIds) this.sendLobby(clientId);
  }

  private broadcastPlayback(): void {
    const state = this.status === "running" ? "playing" : this.status === "paused" ? "paused" : this.status === "done" ? "done" : "stopped";
    this.broadcastAll({ type: "playback", state, raidId: this.raidId, hostClientId: this.hostClientId });
  }

  private broadcastStarted(): void {
    for (const connectedClientId of this.clientIds) {
      if (this.observers.has(connectedClientId)) {
        this.send(connectedClientId, this.startedMessage(null));
        continue;
      }
      const playerId = this.playerForClient(connectedClientId);
      if (!playerId) {
        this.sendError(connectedClientId, "Claim a slot to join the running session");
        continue;
      }
      this.send(connectedClientId, this.startedMessage(playerId));
    }
  }

  private broadcastAll(message: ServerMessage): void {
    const json = JSON.stringify(message);
    for (const clientId of this.clientIds) this.send(clientId, json);
  }

  private sendError(clientId: string, message: string): void {
    logger.warn("session", "rejected", { session: this.id, clientId, reason: message });
    this.send(clientId, { type: "error", message });
  }
}
