import { dirname, join } from "path";
import { readRaidObject } from "./raidFileReader";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../engine/raidLoader";
import type { RaidDef } from "../engine/raidSchema";
import { createWorld } from "../engine/world";
import { CLOCK_SPOTS, EMPTY_RAID_ID, MAX_OBSERVERS, ROSTER, type ClientMessage, type Frame, type LobbySlot, type LobbyStatus, type ServerMessage } from "../shared/protocol";
import type { Intent, Intents, World } from "../shared/types";
import { logger } from "../shared/logger";
import { metrics } from "./metrics";

/**
 * Per-session sink for simulation events (the entries the engine pushes onto
 * `world.log`). Written unconditionally — independent of the global LOG_LEVEL
 * app-log filter — so a raid's event history is always captured. Injected by
 * the server entry; left undefined in tests so no files are touched.
 */
export interface SessionLog {
  // One-time pull header (tick-0 world + raid id) so the relayed frames are replayable on their own.
  header(raidId: string, world: World): void;
  frame(startTick: number, frames: Frame[]): void;
  close(): void;
}

const DT = 1 / 60;
const TICK_MS = 1000 / 60;
const MAX_CATCH_UP_STEPS = 5;
// Defensive ceiling so a room whose host never sends `simEnded` can't relay idle frames forever.
// Generous slack past the raid duration; the host normally ends the pull near `duration`.
const PULL_GRACE_SECONDS = 30;
// Bound the per-tick desync-hash table so it can't grow without limit on a long pull.
const MAX_HASH_WINDOW = 64;
// Clients report a hash every ~5s; drop anything more frequent so a client can't spam the relay.
const MIN_HASH_REPORT_MS = 1000;
export const LOBBY_TIMEOUT_MS = 10 * 60 * 1000;
// Pristine lobbies (never started, no slot claimed) are reaped far sooner so a flood
// of unused rooms can't squat on the per-backend cap. Never exceeds LOBBY_TIMEOUT_MS.
export const EMPTY_LOBBY_TIMEOUT_MS = 90 * 1000;

type SendMessage = (clientId: string, message: ServerMessage | string) => void;
type TickHandle = ReturnType<typeof setInterval>;
type RaidPlayerDef = RaidDef["players"][number];

const idleIntent: Intent = { move: { x: 0, z: 0 } };


function mergePendingIntent(previous: Intent | undefined, next: Intent): Intent {
  return {
    move: { x: next.move.x, z: next.move.z },
    facing: next.facing ?? previous?.facing,
    jump: previous?.jump || next.jump || undefined,
    sprint: previous?.sprint || next.sprint || undefined,
    antiKnockback: previous?.antiKnockback || next.antiKnockback || undefined,
    provoke: previous?.provoke || next.provoke || undefined,
    toggleInvincibility: previous?.toggleInvincibility || next.toggleInvincibility || undefined,
  };
}

function createEmptyRaid(): RaidDef {
  const players: RaidPlayerDef[] = ROSTER.map(({ id, role }) => ({ id, role, spawn: CLOCK_SPOTS[id] }));
  return {
    name: "(empty)",
    arena: { zones: [{ kind: "circle", center: [0, 0], radius: 20 }] },
    duration: 30,
    players,
    events: [],
  };
}

export async function loadSessionRaid(raidId: string, raidsDir: string): Promise<RaidDef> {
  if (raidId === EMPTY_RAID_ID) return createEmptyRaid();

  const raid = loadRaid(await readRaidObject(join(raidsDir, raidId)));
  if (!raid.botPatterns) return raid;
  const categoryDir = dirname(raidId);
  return applyBotPatterns(raid, loadBotPatterns(await readRaidObject(join(raidsDir, categoryDir, raid.botPatterns))));
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
  createSessionLog?: (sessionId: string) => SessionLog;
}

export class Session {
  readonly id: string;
  raidId: string;
  readonly slots = new Map<string, string | null>();
  readonly observers = new Set<string>();
  status: SessionStatus = "lobby";
  hostClientId = "";
  raidRequestSeq = 0;
  // The pull's initial (tick-0) world. The server never ticks it — clients run the engine. It is
  // sent on `started` so a fresh/late client can rebuild the world by replaying the input log.
  world: World;
  // Authoritative input log: one merged-intent Frame per simulated tick since the pull started.
  // `inputLog.length` is the current tick. Sent in full on late join / resync and replayed
  // synchronously by the client. Bounded by pull length (~18k frames / 5min at 60Hz, MBs of JSON),
  // so the replay blocks the joining client briefly — fine for MVP-length pulls.
  // TODO: chunk the replay or periodically checkpoint the world server-side to cap resync cost.
  readonly inputLog: Frame[] = [];

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
  private frameBatch: Frame[] = [];
  private maxPullTicks = Infinity;
  // Canonical world hash per tick = the host's hash (it has end-of-pull authority); a mismatch from
  // any other client is a desync. Trusting the host avoids "resyncing" honest clients toward a
  // desynced one when that client happens to report first.
  private readonly canonicalHashes = new Map<number, number>();
  // Non-host hash reports awaiting the host's canonical hash for the same tick (the host's report
  // may arrive later); verified and dropped once the host's hash lands.
  private readonly pendingHashes = new Map<number, Map<string, number>>();
  // Last time each client's hash report was accepted, for rate-capping.
  private readonly lastHashReportAt = new Map<string, number>();
  private readonly sessionLog: SessionLog | null;
  private botsInvincible = false;

  constructor(options: SessionOptions) {
    this.id = options.id;
    this.raidId = options.raidId;
    this.raid = options.raid;
    this.send = options.send;
    this.now = options.now ?? Date.now;
    this.autoTick = options.autoTick ?? true;
    this.lobbyTimeoutMs = options.lobbyTimeoutMs ?? LOBBY_TIMEOUT_MS;
    this.sessionLog = options.createSessionLog?.(options.id) ?? null;
    this.lastActivity = this.now();

    for (const player of this.raid.players) this.slots.set(player.id, null);
    this.world = this.freshWorld();
    this.resetPull();
  }

  join(clientId: string): void {
    this.touch();
    this.clients.add(clientId);
    if (!this.hostClientId) this.hostClientId = clientId;
    this.sendLobby(clientId);
    logger.info("session", "client joined", { session: this.id, clientId, clients: this.clients.size });
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
    this.startTick();
    this.broadcastPlayback();
    this.broadcastStarted();
    logger.info("session", "raid changed", { session: this.id, raid: this.raidId });
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
    this.startTick();
    this.broadcastPlayback();
    logger.info("session", "resumed", { session: this.id, raid: this.raidId });
  }

  pause(clientId: string): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can pause");
      return;
    }
    if (this.status !== "running") return;

    this.flushFrames(); // deliver everything up to the pause point before halting the relay
    this.status = "paused";
    this.stopTick();
    this.broadcastPlayback();
    logger.info("session", "paused", { session: this.id, raid: this.raidId });
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
    this.world = this.freshWorld();
    this.applyBotsInvincible();
    this.resetPull();
    // Reset every client's local world to the fresh (frozen) one, then signal the stopped state.
    this.broadcastStarted();
    this.broadcastPlayback();
    logger.info("session", "raid stopped", { session: this.id, raid: this.raidId });
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
    this.world = this.freshWorld();
    this.applyBotsInvincible();
    this.resetPull();
    this.startTick();
    this.broadcastPlayback();
    this.broadcastStarted();
    logger.info("session", "raid restarted", { session: this.id, raid: this.raidId });
  }

  disconnect(clientId: string): boolean {
    this.touch();
    this.clients.delete(clientId);
    logger.info("session", "client disconnected", { session: this.id, clientId, clients: this.clients.size });

    for (const [playerId, ownerId] of this.slots) {
      if (ownerId === clientId) {
        this.slots.set(playerId, null);
        this.latestIntents.delete(playerId);
      }
    }
    this.observers.delete(clientId);

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

    if (this.status === "running" || this.status === "paused" || this.status === "stopped") {
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

    if (this.status === "running" || this.status === "paused" || this.status === "stopped") {
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

    this.startTick();
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

  // Advance the relay by one tick: stamp the merged human intents for this tick, append to the input
  // log, and (unless batching) broadcast immediately. The server never runs `tick()`; clients do.
  step(broadcast = true): void {
    if (this.status !== "running") return;
    this.produceFrame();
    if (broadcast) this.flushFrames();
  }

  // Merge each owned slot's latest intent into this tick's frame, mirroring the old `step()` exactly:
  // move + facing carry forward between ticks; one-shot actions (jump/sprint/provoke/…) fire once.
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

  private produceFrame(): void {
    const frame = this.buildFrame();
    this.inputLog.push(frame);
    this.frameBatch.push(frame);
    this.sessionLog?.frame(this.inputLog.length - 1, [frame]);
    if (this.inputLog.length >= this.maxPullTicks) this.endPullDefensively();
  }

  private flushFrames(): void {
    if (this.frameBatch.length === 0) return;
    const startTick = this.inputLog.length - this.frameBatch.length;
    this.broadcast({ type: "frames", startTick, frames: this.frameBatch });
    metrics.framesBroadcast.inc(this.frameBatch.length);
    this.frameBatch = [];
  }

  // Reset per-pull relay state. Called whenever a fresh tick-0 world is built (start/restart/stop/
  // setRaid) so the input log, batching, and desync window start clean.
  private resetPull(): void {
    this.inputLog.length = 0;
    this.frameBatch = [];
    this.canonicalHashes.clear();
    this.pendingHashes.clear();
    this.lastHashReportAt.clear();
    this.tickAccumulator = 0;
    this.maxPullTicks = Math.ceil((this.world.duration + PULL_GRACE_SECONDS) / DT);
    // On a real pull start (start/restart set status="running" before this; the constructor's
    // lobby-time reset does not), record the tick-0 world so the session log is self-contained:
    // its seed + this header let the relayed frames be replayed without any other state.
    if (this.status === "running") this.sessionLog?.header(this.raidId, this.world);
  }

  private startedMessage(playerId: string | null): ServerMessage {
    return { type: "started", world: this.world, yourPlayerId: playerId, tick: this.inputLog.length, frames: this.inputLog };
  }

  // The host's local sim reached a terminal state (wiped/cleared). Stop relaying and mark the pull
  // done — equivalent authority to the host's `stop`, which it can already do at any time.
  simEnded(clientId: string, tick: number): void {
    if (clientId !== this.hostClientId) {
      this.sendError(clientId, "Only the host can end the session");
      return;
    }
    if (this.status !== "running") return;
    this.flushFrames();
    this.status = "done";
    this.stopTick();
    this.broadcastPlayback();
    logger.info("session", "sim ended", { session: this.id, raid: this.raidId, tick, ticks: this.inputLog.length });
  }

  // Defensive: a host that never sends `simEnded` would otherwise have the room relay idle frames
  // forever (running sessions never expire). Cap the pull well past its duration and finish it.
  private endPullDefensively(): void {
    this.flushFrames();
    this.status = "done";
    this.stopTick();
    this.broadcastPlayback();
    logger.warn("session", "pull hit tick ceiling without simEnded", { session: this.id, ticks: this.inputLog.length });
  }

  // Desync detection: the first hash seen for a tick is canonical. A later, different hash for the
  // same tick means that client's floats diverged — count it and resync the offender by replaying.
  reportWorldHash(clientId: string, tick: number, hash: number): void {
    const now = this.now();
    if (now - (this.lastHashReportAt.get(clientId) ?? -Infinity) < MIN_HASH_REPORT_MS) return;
    this.lastHashReportAt.set(clientId, now);

    if (clientId === this.hostClientId) {
      this.canonicalHashes.set(tick, hash);
      const pending = this.pendingHashes.get(tick);
      if (pending) {
        for (const [cid, reported] of pending) if (reported !== hash) this.flagDesync(tick, hash, reported, cid);
        this.pendingHashes.delete(tick);
      }
      this.pruneHashWindow();
      return;
    }

    const canonical = this.canonicalHashes.get(tick);
    if (canonical === undefined) {
      let pending = this.pendingHashes.get(tick);
      if (!pending) { pending = new Map(); this.pendingHashes.set(tick, pending); }
      pending.set(clientId, hash);
      this.pruneHashWindow();
      return;
    }
    if (canonical === hash) return;
    this.flagDesync(tick, canonical, hash, clientId);
  }

  private flagDesync(tick: number, expected: number, got: number, clientId: string): void {
    metrics.desyncTotal.inc();
    logger.warn("session", "world desync", { session: this.id, tick, expected, got, clientId });
    this.resync(clientId);
  }

  private resync(clientId: string): void {
    if (this.observers.has(clientId)) {
      this.send(clientId, this.startedMessage(null));
      return;
    }
    const playerId = this.playerForClient(clientId);
    if (playerId) this.send(clientId, this.startedMessage(playerId));
  }

  private pruneHashWindow(): void {
    while (this.canonicalHashes.size > MAX_HASH_WINDOW) {
      this.canonicalHashes.delete(Math.min(...this.canonicalHashes.keys()));
    }
    // Pending reports for a tick the host never canonicalized (e.g. its report was rate-dropped)
    // would otherwise leak; bound them the same way.
    while (this.pendingHashes.size > MAX_HASH_WINDOW) {
      this.pendingHashes.delete(Math.min(...this.pendingHashes.keys()));
    }
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
    this.stopTick();
    this.sessionLog?.close();
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
      this.produceFrame();
      this.tickAccumulator -= DT;
      steps++;
    }

    if (steps === MAX_CATCH_UP_STEPS && this.tickAccumulator >= DT) {
      this.tickAccumulator = 0;
      metrics.catchupExhausted.inc();
    }

    // Relay everything produced this loop in one message (≈1 frame per call at 60Hz; more only when
    // catching up). Tiny per-tick frames already keep egress to a couple KB/s per client.
    this.flushFrames();
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
    for (const clientId of this.clients) this.sendLobby(clientId);
  }

  private broadcastPlayback(): void {
    const state = this.status === "running" ? "playing" : this.status === "paused" ? "paused" : "stopped";
    this.broadcast({ type: "playback", state, raidId: this.raidId, hostClientId: this.hostClientId });
  }

  private broadcastStarted(): void {
    for (const connectedClientId of this.clients) {
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

  private broadcast(message: ServerMessage): void {
    const json = JSON.stringify(message);
    for (const clientId of this.clients) this.send(clientId, json);
  }

  private sendError(clientId: string, message: string): void {
    logger.warn("session", "rejected", { session: this.id, clientId, reason: message });
    this.send(clientId, { type: "error", message });
  }
}

export interface SessionManagerOptions {
  raidsDir: string;
  send: SendMessage;
  now?: () => number;
  lobbyTimeoutMs?: number;
  createSessionLog?: (sessionId: string) => SessionLog;
  /** Maximum allocated rooms on this backend. Defaults to unlimited. */
  maxSessions?: number;
}

export interface CapacitySnapshot {
  sessions: number;
  maxSessions: number;
  availableSessions: number;
}

/** Point-in-time room capacity, used by the /metrics/sessions endpoint. */
export function capacitySnapshot(sessions: number, maxSessions: number): CapacitySnapshot {
  return { sessions, maxSessions, availableSessions: Math.max(0, maxSessions - sessions) };
}

export class SessionManager {
  readonly sessions = new Map<string, Session>();

  private readonly raidsDir: string;
  private readonly send: SendMessage;
  private readonly clientSessions = new Map<string, string>();
  private readonly now?: () => number;
  private readonly lobbyTimeoutMs?: number;
  private readonly createSessionLog?: (sessionId: string) => SessionLog;
  private readonly maxSessions: number;

  constructor(options: SessionManagerOptions) {
    this.raidsDir = options.raidsDir;
    this.send = options.send;
    this.now = options.now;
    this.lobbyTimeoutMs = options.lobbyTimeoutMs;
    this.createSessionLog = options.createSessionLog;
    this.maxSessions = options.maxSessions ?? Infinity;
  }

  sessionCount(): number {
    return this.sessions.size;
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
    if (message.type === "debugPosition") return;

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
      // Joining an existing room is always allowed even when full; only creating a
      // new room is gated. Prune dead lobbies first so they don't reject spuriously.
      this.pruneExpired();
      if (this.sessionCount() >= this.maxSessions) {
        this.send(clientId, { type: "error", message: "Server is full" });
        return;
      }

      const raid = await loadSessionRaid(raidId, this.raidsDir);
      session = this.sessions.get(sessionId);
      if (!session) {
        // Re-check after the await: a concurrent create may have filled the pool.
        if (this.sessionCount() >= this.maxSessions) {
          this.send(clientId, { type: "error", message: "Server is full" });
          return;
        }
        session = new Session({
          id: sessionId,
          raidId,
          raid,
          send: this.send,
          now: this.now,
          lobbyTimeoutMs: this.lobbyTimeoutMs,
          createSessionLog: this.createSessionLog,
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
      logger.warn("session", "raid not found", { clientId, raid: raidId });
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
