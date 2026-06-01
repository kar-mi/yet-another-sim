import { join } from "path";
import { computeBotIntents } from "../src/engine/botIntent";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../src/engine/raidLoader";
import type { RaidDef } from "../src/engine/raidSchema";
import { tick } from "../src/engine/sim";
import { createWorld } from "../src/engine/world";
import { CLOCK_SPOTS, EMPTY_RAID_ID, ROSTER, type ClientMessage, type LobbySlot, type LobbyStatus, type ServerMessage } from "../src/shared/protocol";
import type { Intent, Intents, World } from "../src/shared/types";

const DT = 1 / 60;
const TICK_MS = 1000 / 60;
const MAX_CATCH_UP_STEPS = 5;
export const LOBBY_TIMEOUT_MS = 10 * 60 * 1000;

type SendMessage = (clientId: string, message: ServerMessage) => void;
type TickHandle = ReturnType<typeof setInterval>;
type RaidPlayerDef = RaidDef["players"][number];

const idleIntent: Intent = { move: { x: 0, z: 0 } };

function cloneIntent(intent: Intent): Intent {
  return {
    move: { x: intent.move.x, z: intent.move.z },
    jump: intent.jump,
    sprint: intent.sprint,
    antiKnockback: intent.antiKnockback,
  };
}

function mergePendingIntent(previous: Intent | undefined, next: Intent): Intent {
  return {
    move: { x: next.move.x, z: next.move.z },
    jump: previous?.jump || next.jump || undefined,
    sprint: previous?.sprint || next.sprint || undefined,
    antiKnockback: previous?.antiKnockback || next.antiKnockback || undefined,
    toggleInvincibility: previous?.toggleInvincibility || next.toggleInvincibility || undefined,
  };
}

function createEmptyRaid(): RaidDef {
  const players: RaidPlayerDef[] = ROSTER.map(({ id, role }) => ({ id, role, control: "bot", spawn: CLOCK_SPOTS[id] }));
  return {
    name: "(empty)",
    arena: { zones: [{ kind: "circle", center: [0, 0], radius: 30 }] },
    duration: 30,
    players,
    events: [],
  };
}

export async function loadSessionRaid(raidId: string, raidsDir: string): Promise<RaidDef> {
  if (raidId === EMPTY_RAID_ID) return createEmptyRaid();

  const raid = loadRaid(await Bun.file(join(raidsDir, `${raidId}.json`)).json());
  if (!raid.botPatterns) return raid;
  return applyBotPatterns(raid, loadBotPatterns(await Bun.file(join(raidsDir, `${raid.botPatterns}.json`)).json()));
}

export type SessionStatus = LobbyStatus;

export interface SessionOptions {
  id: string;
  raidId: string;
  raid: RaidDef;
  send: SendMessage;
  now?: () => number;
  autoTick?: boolean;
  lobbyTimeoutMs?: number;
}

export class Session {
  readonly id: string;
  raidId: string;
  readonly slots = new Map<string, string | null>();
  status: SessionStatus = "lobby";
  hostClientId = "";
  raidRequestSeq = 0;
  world: World;

  private raid: RaidDef;
  private readonly send: SendMessage;
  private readonly clients = new Set<string>();
  private readonly latestIntents = new Map<string, Intent>();
  private readonly now: () => number;
  private readonly autoTick: boolean;
  private readonly lobbyTimeoutMs: number;
  private lastActivity: number;
  private tickHandle: TickHandle | null = null;
  private tickAccumulator = 0;
  private lastTickAt = 0;

  constructor(options: SessionOptions) {
    this.id = options.id;
    this.raidId = options.raidId;
    this.raid = options.raid;
    this.send = options.send;
    this.now = options.now ?? Date.now;
    this.autoTick = options.autoTick ?? true;
    this.lobbyTimeoutMs = options.lobbyTimeoutMs ?? LOBBY_TIMEOUT_MS;
    this.lastActivity = this.now();

    for (const player of this.raid.players) this.slots.set(player.id, null);
    this.world = createWorld(this.raidWithSlotControls());
  }

  join(clientId: string): void {
    this.touch();
    this.clients.add(clientId);
    if (!this.hostClientId) this.hostClientId = clientId;
    this.sendLobby(clientId);
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
      case "restart":
        this.restart(clientId);
        return;
      case "intent":
        this.setIntent(clientId, message.intent);
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
    this.world = createWorld(this.raidWithSlotControls());
    if (this.status === "lobby") {
      this.broadcastLobby();
      return;
    }

    this.status = "running";
    this.startTick();
    this.broadcastPlayback();
    this.broadcastStarted();
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

    this.status = "running";
    this.world = { ...this.world, status: "running" };
    this.startTick();
    this.broadcastPlayback();
  }

  pause(clientId: string): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can pause");
      return;
    }
    if (this.status !== "running") return;

    this.status = "paused";
    this.stopTick();
    this.broadcastPlayback();
  }

  stop(clientId: string): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can stop");
      return;
    }
    if (this.status === "lobby") return;

    this.status = "stopped";
    this.stopTick();
    this.latestIntents.clear();
    this.world = createWorld(this.raidWithSlotControls());
    this.broadcastPlayback();
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

    this.status = "running";
    this.latestIntents.clear();
    this.world = createWorld(this.raidWithSlotControls());
    this.startTick();
    this.broadcastPlayback();
    this.broadcastStarted();
  }

  disconnect(clientId: string): boolean {
    this.touch();
    this.clients.delete(clientId);

    for (const [playerId, ownerId] of this.slots) {
      if (ownerId === clientId) {
        this.slots.set(playerId, null);
        this.latestIntents.delete(playerId);
      }
    }

    const hostChanged = this.hostClientId === clientId;
    if (hostChanged) {
      this.hostClientId = this.clients.values().next().value ?? "";
    }

    this.applySlotControlsToWorld();
    if (this.clients.size === 0) {
      this.dispose();
      return true;
    }

    this.broadcastLobby();
    if (hostChanged && this.status !== "lobby") this.broadcastPlayback();
    return false;
  }

  claimSlot(clientId: string, playerId: string): void {
    if (!this.slots.has(playerId)) {
      this.sendError(clientId, "Unknown player slot");
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

    if (this.status === "running") {
      this.send(clientId, { type: "started", world: this.world, yourPlayerId: playerId });
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

  start(clientId: string): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can start");
      return;
    }
    if (this.status !== "lobby") {
      this.sendError(clientId, "Session already started");
      return;
    }
    if (![...this.slots.values()].some(ownerId => ownerId !== null)) {
      this.sendError(clientId, "Claim a slot before starting");
      return;
    }

    this.status = "running";
    this.world = createWorld(this.raidWithSlotControls());

    this.broadcastStarted();

    this.startTick();
  }

  setIntent(clientId: string, intent: Intent): void {
    if (this.status !== "running") return;
    const playerId = this.playerForClient(clientId);
    if (!playerId) return;
    this.latestIntents.set(playerId, mergePendingIntent(this.latestIntents.get(playerId), intent));
  }

  step(broadcastSnapshot = true): void {
    if (this.status !== "running") return;

    const humanIntents: Intents = {};
    for (const [playerId, ownerId] of this.slots) {
      if (!ownerId) continue;
      const latestIntent = this.latestIntents.get(playerId) ?? idleIntent;
      humanIntents[playerId] = latestIntent;
      this.latestIntents.set(playerId, { move: latestIntent.move });
    }

    this.world = tick(this.world, { ...computeBotIntents(this.world, DT), ...humanIntents }, DT);
    if (broadcastSnapshot) this.broadcast({ type: "snapshot", world: this.world });

    if (this.world.status !== "running") {
      this.status = "done";
      this.stopTick();
      if (!broadcastSnapshot) this.broadcast({ type: "snapshot", world: this.world });
    }
  }

  isExpired(now = this.now()): boolean {
    return this.status !== "running" && now - this.lastActivity >= this.lobbyTimeoutMs;
  }

  dispose(): void {
    this.stopTick();
  }

  private touch(): void {
    this.lastActivity = this.now();
  }

  private stopTick(): void {
    if (!this.tickHandle) return;
    clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  private startTick(): void {
    if (!this.autoTick) return;
    this.lastTickAt = this.now();
    this.tickAccumulator = 0;
    this.stopTick();
    this.tickHandle = setInterval(() => this.runDueTicks(), TICK_MS);
  }

  private runDueTicks(): void {
    if (this.status !== "running") return;

    const now = this.now();
    const elapsed = Math.min((now - this.lastTickAt) / 1000, 0.25);
    this.lastTickAt = now;
    this.tickAccumulator += Math.max(0, elapsed);

    let steps = 0;
    while (this.tickAccumulator >= DT && steps < MAX_CATCH_UP_STEPS && this.status === "running") {
      this.step(false);
      this.tickAccumulator -= DT;
      steps++;
    }

    if (steps === MAX_CATCH_UP_STEPS && this.tickAccumulator >= DT) {
      this.tickAccumulator = 0;
    }

    if (steps > 0 && this.status === "running") {
      this.broadcast({ type: "snapshot", world: this.world });
    }
  }

  private playerForClient(clientId: string): string | null {
    for (const [playerId, ownerId] of this.slots) {
      if (ownerId === clientId) return playerId;
    }
    return null;
  }

  private raidWithSlotControls(): RaidDef {
    return {
      ...this.raid,
      players: this.raid.players.map(player => ({
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
      players: this.world.players.map(player => ({
        ...player,
        control: controlByPlayer.get(player.id) ?? player.control,
      })),
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
    };
  }

  private sendLobby(clientId: string): void {
    this.send(clientId, this.lobbyFor(clientId));
  }

  private broadcastLobby(): void {
    for (const clientId of this.clients) this.sendLobby(clientId);
  }

  private broadcastPlayback(): void {
    const state = this.status === "running" ? "playing" : this.status === "paused" ? "paused" : "stopped";
    this.broadcast({ type: "playback", state, raidId: this.raidId, hostClientId: this.hostClientId, world: this.world });
  }

  private broadcastStarted(): void {
    for (const connectedClientId of this.clients) {
      const playerId = this.playerForClient(connectedClientId);
      if (!playerId) {
        this.sendError(connectedClientId, "Claim a slot to join the running session");
        continue;
      }
      this.send(connectedClientId, {
        type: "started",
        world: this.world,
        yourPlayerId: playerId,
      });
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const clientId of this.clients) this.send(clientId, message);
  }

  private sendError(clientId: string, message: string): void {
    this.send(clientId, { type: "error", message });
  }
}

export interface SessionManagerOptions {
  raidsDir: string;
  send: SendMessage;
  now?: () => number;
  lobbyTimeoutMs?: number;
}

export class SessionManager {
  readonly sessions = new Map<string, Session>();

  private readonly raidsDir: string;
  private readonly send: SendMessage;
  private readonly clientSessions = new Map<string, string>();
  private readonly now?: () => number;
  private readonly lobbyTimeoutMs?: number;

  constructor(options: SessionManagerOptions) {
    this.raidsDir = options.raidsDir;
    this.send = options.send;
    this.now = options.now;
    this.lobbyTimeoutMs = options.lobbyTimeoutMs;
  }

  async handle(clientId: string, message: ClientMessage): Promise<void> {
    if (message.type === "join") {
      await this.join(clientId, message.sessionId, message.raidId);
      return;
    }

    if (message.type === "setRaid") {
      await this.setRaid(clientId, message.raidId);
      return;
    }

    const session = this.sessionFor(clientId);
    if (!session) {
      this.send(clientId, { type: "error", message: "Join a session first" });
      return;
    }

    session.handle(clientId, message);
  }

  disconnect(clientId: string): void {
    const session = this.sessionFor(clientId);
    this.clientSessions.delete(clientId);
    if (!session) return;

    if (session.disconnect(clientId)) {
      this.sessions.delete(session.id);
    }
  }

  pruneExpired(): void {
    for (const [sessionId, session] of this.sessions) {
      if (!session.isExpired(this.now?.())) continue;
      session.dispose();
      this.sessions.delete(sessionId);

      for (const [clientId, clientSessionId] of this.clientSessions) {
        if (clientSessionId === sessionId) this.clientSessions.delete(clientId);
      }
    }
  }

  private async join(clientId: string, sessionId: string, raidId: string): Promise<void> {
    const existingSessionId = this.clientSessions.get(clientId);
    if (existingSessionId && existingSessionId !== sessionId) {
      this.disconnect(clientId);
    }

    let session = this.sessions.get(sessionId);
    if (!session) {
      const raid = await loadSessionRaid(raidId, this.raidsDir);
      session = this.sessions.get(sessionId);
      if (!session) {
        session = new Session({
          id: sessionId,
          raidId,
          raid,
          send: this.send,
          now: this.now,
          lobbyTimeoutMs: this.lobbyTimeoutMs,
        });
        this.sessions.set(sessionId, session);
      }
    }

    this.clientSessions.set(clientId, sessionId);
    session.join(clientId);
  }

  private async setRaid(clientId: string, raidId: string): Promise<void> {
    const session = this.sessionFor(clientId);
    if (!session) {
      this.send(clientId, { type: "error", message: "Join a session first" });
      return;
    }

    const seq = ++session.raidRequestSeq;
    let raid: RaidDef;
    try {
      raid = await loadSessionRaid(raidId, this.raidsDir);
    } catch {
      this.send(clientId, { type: "error", message: "Raid not found" });
      return;
    }

    if (session.raidRequestSeq !== seq) return;
    if (this.sessions.get(session.id) !== session) return;

    session.setRaid(clientId, raidId, raid);
  }

  private sessionFor(clientId: string): Session | undefined {
    const sessionId = this.clientSessions.get(clientId);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }
}
