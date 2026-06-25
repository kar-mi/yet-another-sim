import { type ClientMessage, type Frame, type ServerMessage } from "@shared/protocol";
import type { Boss, Player, World } from "@shared/types";
import { length, shortestAngleDelta, sub, type Vec2 } from "@shared/math";
import { tick } from "../engine/sim";
import { computeBotIntents } from "../engine/botIntent";
import { worldHash } from "@shared/worldHash";
import { WORLD_RENDER_KEYS, computeWorldRenderKeys, getWorldRenderKeys, setWorldRenderKeys, type WorldRenderKeys } from "./worldRenderKeys";

declare const __YAS_STATIC__: boolean | undefined;

export interface Transport {
  open(): Promise<void>;
  send(message: ClientMessage): boolean;
  onMessage(cb: (message: ServerMessage) => void): void;
  onReconnect(cb: () => void): void;
  close(): void;
}

type MessageType = ServerMessage["type"];
type Handler<T extends MessageType> = (message: Extract<ServerMessage, { type: T }>) => void;

const DT = 1 / 60;
const TICK_MS = 1000 / 60;
// Floor is ~1 tick for lowest lag on clean links; ceiling caps lag under heavy jitter.
const MIN_RENDER_DELAY_MS = 16;
const MAX_RENDER_DELAY_MS = 80;
// Exponential recovery time-constant (seconds) for shrinking the render buffer after jitter spikes.
const DRAIN_TAU_S = 2;
const SNAPSHOT_BUFFER_MAX = 32;
const SNAPSHOT_GAP_RESET_MS = 250;
// Cap forward extrapolation so a long stall holds rather than flinging entities.
const EXTRAPOLATE_MAX_MS = 100;
// How fast the snapshot playout clock tracks wall-clock drift. Small so snapshots stay spaced at a
// steady TICK_MS apart (smooth interpolation) regardless of network burstiness, while still slowly
// following genuine clock drift between the server's tick loop and this client's render clock.
const CLOCK_SMOOTH = 0.02;
const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 8000;
// Report a world hash this often (in ticks) so the server can detect cross-client desync.
const HASH_INTERVAL = 300;
// Host sends a world snapshot this often; replay tail on late join is bounded by this interval.
const SNAPSHOT_INTERVAL = 600;
const BOSS_SNAP_THRESHOLD = 3;

export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private messageHandler: (message: ServerMessage) => void = () => {};
  private reconnectHandler: () => void = () => {};
  private closing = false;
  private opened = false;
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly url: string) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.attachSocket();
      ws.addEventListener("open", () => {
        this.opened = true;
        resolve();
      }, { once: true });
      ws.addEventListener("error", () => reject(new Error("Failed to connect to server")), { once: true });
    });
  }

  send(message: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  onMessage(cb: (message: ServerMessage) => void): void {
    this.messageHandler = cb;
  }

  onReconnect(cb: () => void): void {
    this.reconnectHandler = cb;
  }

  close(): void {
    this.closing = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
  }

  private attachSocket(): WebSocket {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener("message", event => {
      if (typeof event.data !== "string") return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      if (!message || typeof message.type !== "string") return;
      this.messageHandler(message);
    });
    ws.addEventListener("close", () => {
      if (this.ws === ws) this.ws = null;
      if (!this.closing && this.opened) this.scheduleReconnect();
    });
    return ws;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closing) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const ws = this.attachSocket();
      ws.addEventListener("open", () => {
        this.reconnectDelay = RECONNECT_INITIAL_MS;
        this.reconnectHandler();
      }, { once: true });
    }, delay);
  }
}

type Snapshot = { t: number; world: World };

// Server-relayed deterministic lockstep: every client runs the engine locally. The server sends the
// initial world plus a stream of input frames; stepping `tick()` from the same seed + frames yields
// a byte-identical world on every client. No world snapshots are ever sent during play.
export class NetClient {
  clientId: string | null = null;

  private readonly handlers = new Map<MessageType, Set<(message: ServerMessage) => void>>();
  private readonly snapshots: Snapshot[] = [];
  private lastJoin: { sessionId: string; raidId: string } | null = null;
  private claimedPlayerId: string | null = null;
  private observing = false;
  private worldRenderKeys: WorldRenderKeys | null = null;
  private renderDelayMs = MIN_RENDER_DELAY_MS;
  private lastAdaptNow = 0;
  // Playout clock for the snapshot buffer: maps a tick number to a render-timeline timestamp so
  // snapshots are spaced at a steady TICK_MS apart, independent of jittery/bursty frame arrival.
  private snapClockBase: number | null = null;
  private lastSnapshotWall = 0; // wall-clock arrival of the last snapshot, for gap detection

  // Local simulation state.
  private world: World | null = null;
  private appliedTick = 0;       // number of input frames applied == current sim tick
  private isHost = false;
  private simEndedSent = false;  // host: simEnded already reported for this pull

  constructor(private readonly transport: Transport) {
    transport.onMessage(message => this.handleMessage(message));
    transport.onReconnect(() => this.resumeSession());
  }

  open(): Promise<void> {
    return this.transport.open();
  }

  send(message: ClientMessage): boolean {
    if (message.type === "join") {
      this.lastJoin = { sessionId: message.sessionId, raidId: message.raidId };
    }
    if (message.type === "claimSlot") this.claimedPlayerId = message.playerId;
    if (message.type === "releaseSlot" && this.claimedPlayerId === message.playerId) this.claimedPlayerId = null;
    if (message.type === "claimObserver") {
      this.claimedPlayerId = null;
    }
    if (message.type === "releaseObserver") this.observing = false;

    return this.transport.send(message);
  }

  on<T extends MessageType>(type: T, handler: Handler<T>): () => void {
    const wrapped = handler as (message: ServerMessage) => void;
    const handlers = this.handlers.get(type) ?? new Set<(message: ServerMessage) => void>();
    handlers.add(wrapped);
    this.handlers.set(type, handlers);
    return () => handlers.delete(wrapped);
  }

  getRenderView(now: number): World | null {
    const buf = this.snapshots;
    if (buf.length === 0) return null;

    return this.interpolatedView(now);
  }

  private interpolatedView(now: number): World {
    const buf = this.snapshots;
    if (buf.length === 1) return buf[0].world;

    const last = buf[buf.length - 1];
    const headroom = last.t - (now - this.renderDelayMs);
    if (headroom < TICK_MS) {
      this.renderDelayMs = Math.min(MAX_RENDER_DELAY_MS, this.renderDelayMs + (TICK_MS - headroom));
    } else {
      const dt = this.lastAdaptNow ? (now - this.lastAdaptNow) / 1000 : 0;
      // Previously ~2ms/s (~30s recovery); drain excess exponentially while inflating immediately.
      if (headroom > 2 * TICK_MS) {
        const excess = headroom - 2 * TICK_MS;
        const k = Math.min(1, dt / DRAIN_TAU_S);
        this.renderDelayMs = Math.max(MIN_RENDER_DELAY_MS, this.renderDelayMs - excess * k);
      }
    }
    this.lastAdaptNow = now;

    const target = now - this.renderDelayMs;
    if (target <= buf[0].t) return buf[0].world;
    if (target >= last.t) {
      const prev = buf[buf.length - 2];
      if (target > last.t && last.t > prev.t) {
        const over = Math.min(target - last.t, EXTRAPOLATE_MAX_MS);
        const alpha = (last.t - prev.t + over) / (last.t - prev.t);
        return interpolateWorld(prev.world, last.world, alpha);
      }
      return last.world;
    }

    let prevIdx = 0;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= target) { prevIdx = i; break; }
    }
    const prev = buf[prevIdx];
    const next = buf[prevIdx + 1];
    const span = next.t - prev.t;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (target - prev.t) / span)) : 1;
    return interpolateWorld(prev.world, next.world, alpha);
  }

  close(): void {
    this.transport.close();
  }

  private resumeSession(): void {
    if (!this.lastJoin) return;
    this.snapshots.length = 0;
    this.snapClockBase = null;
    const join = this.lastJoin;
    const claim = this.claimedPlayerId;
    const observing = this.observing;
    this.send({ type: "join", sessionId: join.sessionId, raidId: join.raidId });
    if (claim) this.send({ type: "claimSlot", playerId: claim });
    if (observing) this.send({ type: "claimObserver" });
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === "joined") {
      this.clientId = message.clientId;
    }
    if (message.type === "lobby") {
      this.claimedPlayerId = message.slots.find(slot => slot.claimedByYou)?.playerId ?? null;
      this.observing = message.observingByYou;
      this.isHost = this.clientId !== null && this.clientId === message.hostClientId;
    }
    if (message.type === "playback") {
      this.isHost = this.clientId !== null && this.clientId === message.hostClientId;
    }
    if (message.type === "started") {
      this.claimedPlayerId = message.yourPlayerId;
      this.observing = message.yourPlayerId === null;
      this.applyStarted(message);
    } else if (message.type === "frames") {
      this.applyFrames(message);
    } else if (message.type === "sessionExpired") {
      this.lastJoin = null;
      this.claimedPlayerId = null;
      this.observing = false;
      this.isHost = false;
    }

    const handlers = this.handlers.get(message.type as MessageType);
    if (!handlers) return;
    for (const handler of handlers) handler(message);
  }

  // Adopt the pull's world at baseTick and fast-forward by replaying only the tail frames so a fresh
  // start lands at tick 0 and a late join / resync lands exactly where the rest of the room is.
  private applyStarted(message: Extract<ServerMessage, { type: "started" }>): void {
    this.worldRenderKeys = computeWorldRenderKeys(message.world);
    this.world = message.world;
    this.appliedTick = message.baseTick;
    this.simEndedSent = false;
    for (const frame of message.frames) this.stepOne(frame);
    this.snapshots.length = 0;
    this.snapClockBase = null;
    this.pushSnapshot(this.world, this.appliedTick);
  }

  // Apply an incremental run of input frames. `startTick` lets us drop already-applied frames (after
  // a resync) and detect a gap (missed frames) that warrants a full resync via rejoin.
  private applyFrames(message: Extract<ServerMessage, { type: "frames" }>): void {
    if (!this.world) return;
    const offset = this.appliedTick - message.startTick;
    if (offset < 0) { this.resumeSession(); return; } // gap: missed frames, resync from scratch
    for (let i = offset; i < message.frames.length; i++) {
      this.stepOne(message.frames[i]);
      this.pushSnapshot(this.world, this.appliedTick);
      this.maybeReportHash();
      this.maybeReportSnapshot();
    }
    this.maybeReportSimEnded();
  }

  // One deterministic engine step. Control is derived from the frame's intent keys (a slot is human
  // exactly when it has an intent this tick) and bot invincibility from the frame, so every client's
  // `computeBotIntents` is identical. Stops at a terminal world so a finished pull isn't over-run.
  private stepOne(frame: Frame): void {
    const world = this.world;
    if (!world) return;
    if (world.status === "running") {
      const prepared = applyFrameControls(world, frame);
      const bots = computeBotIntents(prepared, DT);
      this.world = tick(prepared, { ...bots, ...frame.intents }, DT);
      // world.log is render-irrelevant on the client and excluded from worldHash; clear it each
      // tick (mirroring the old server step) so it can't grow unbounded across a long pull.
      if (this.world.log.length > 0) this.world.log.length = 0;
    }
    // Advance even when terminal so appliedTick stays in lockstep with the server's frame count;
    // the server keeps relaying frames until the host's simEnded round-trips. Otherwise the next
    // batch's startTick would outrun a frozen appliedTick and trigger a spurious full rejoin.
    this.appliedTick++;
  }

  private maybeReportSnapshot(): void {
    if (!this.isHost || !this.world || this.appliedTick === 0 || this.appliedTick % SNAPSHOT_INTERVAL !== 0) return;
    // Explicitly drop the render-keys symbol: object spread copies enumerable symbol keys (pushSnapshot
    // sets it on this.world just before this runs), and although JSON.stringify would drop it on send,
    // strip it here so `world` is clean.
    const { [WORLD_RENDER_KEYS]: _drop, ...world } = this.world as any;
    this.send({ type: "snapshot", tick: this.appliedTick, world });
  }

  // Report on fixed tick boundaries (not a per-client delta) so every client hashes the SAME ticks.
  // Each client steps every tick, so alignment is guaranteed and the server can actually compare.
  private maybeReportHash(): void {
    if (!this.world || this.appliedTick === 0 || this.appliedTick % HASH_INTERVAL !== 0) return;
    this.send({ type: "worldHash", tick: this.appliedTick, hash: worldHash(this.world) });
  }

  private maybeReportSimEnded(): void {
    if (!this.isHost || this.simEndedSent || !this.world || this.world.status === "running") return;
    this.simEndedSent = true;
    this.send({ type: "simEnded", tick: this.appliedTick });
  }

  private pushSnapshot(world: World, tick: number): void {
    const wall = performance.now();
    if (this.lastSnapshotWall && wall - this.lastSnapshotWall > SNAPSHOT_GAP_RESET_MS) {
      this.snapshots.length = 0;
      this.snapClockBase = null;
    }
    this.lastSnapshotWall = wall;

    // Place the snapshot on the deterministic tick timeline rather than at its wall-clock arrival
    // time: t = base + tick*TICK_MS keeps consecutive ticks exactly TICK_MS apart, so a burst of
    // frames (or network jitter) can't collapse interpolation into instant skips. The base anchors
    // so the newest snapshot sits at ~now, then drifts slowly to track real clock drift.
    const desiredBase = wall - tick * TICK_MS;
    this.snapClockBase = this.snapClockBase === null
      ? desiredBase
      : this.snapClockBase + (desiredBase - this.snapClockBase) * CLOCK_SMOOTH;
    const t = this.snapClockBase + tick * TICK_MS;

    if (!this.worldRenderKeys) this.worldRenderKeys = computeWorldRenderKeys(world);
    setWorldRenderKeys(world, this.worldRenderKeys);
    this.snapshots.push({ t, world });
    if (this.snapshots.length > SNAPSHOT_BUFFER_MAX) this.snapshots.shift();
  }
}

// Reconcile a world's per-player control + bot invincibility with an input frame before stepping.
// This is the single source of truth for who is human each tick, keeping bot computation identical
// across clients regardless of when slots were claimed/released.
function applyFrameControls(world: World, frame: Frame): World {
  return {
    ...world,
    players: world.players.map(player => {
      const human = frame.intents[player.id] !== undefined;
      const control = human ? "human" : "bot";
      // Humans manage their own invincibility via the toggleInvincibility intent (handled in tick);
      // bots follow the host's practice toggle carried in the frame.
      const invincible = human ? player.invincible : frame.botsInvincible;
      return player.control === control && player.invincible === invincible
        ? player
        : { ...player, control, invincible };
    }),
  };
}

export async function connect(): Promise<NetClient> {
  let transport: Transport;
  if (typeof __YAS_STATIC__ !== "undefined" && __YAS_STATIC__) {
    const { LoopbackTransport } = await import("./loopbackTransport");
    transport = new LoopbackTransport();
  } else {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    transport = new WebSocketTransport(`${protocol}//${location.host}`);
  }
  const client = new NetClient(transport);
  await client.open();
  return client;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + shortestAngleDelta(a, b) * t;
}

function interpolatePlayerInto(out: Player, prev: Player | undefined, next: Player, t: number): Player {
  const pos = out.pos;
  Object.assign(out, next);
  out.pos = pos;
  if (!prev) {
    out.pos.x = next.pos.x;
    out.pos.z = next.pos.z;
    return out;
  }
  out.pos.x = lerp(prev.pos.x, next.pos.x, t);
  out.pos.z = lerp(prev.pos.z, next.pos.z, t);
  out.y = lerp(prev.y, next.y, t);
  out.facing = lerpAngle(prev.facing, next.facing, t);
  return out;
}

function interpolateBossInto(out: Boss, prev: Boss, next: Boss, t: number): Boss {
  const snap = length(sub(next.pos, prev.pos)) > BOSS_SNAP_THRESHOLD;
  const pos = out.pos;
  Object.assign(out, next);
  out.pos = pos;
  if (snap) {
    out.pos.x = next.pos.x;
    out.pos.z = next.pos.z;
  } else {
    out.pos.x = lerp(prev.pos.x, next.pos.x, t);
    out.pos.z = lerp(prev.pos.z, next.pos.z, t);
  }
  out.facing = lerpAngle(prev.facing, next.facing, t); // smooth turning (sim snaps per tick)
  return out;
}

type EntityIndex = {
  players: Map<string, Player>;
  bosses: Map<string, Boss>;
};

const entityIndexes = new WeakMap<World, EntityIndex>();

function getEntityIndex(world: World): EntityIndex {
  let index = entityIndexes.get(world);
  if (!index) {
    index = {
      players: new Map(world.players.map(player => [player.id, player])),
      bosses: new Map(world.bosses.map(boss => [boss.id, boss])),
    };
    entityIndexes.set(world, index);
  }
  return index;
}

type InterpolationBuffer = {
  world: World | null;
  players: Player[];
  playerPositions: Vec2[];
  bosses: Boss[];
  bossPositions: Vec2[];
};

const interpolationBuffers: InterpolationBuffer[] = [
  { world: null, players: [], playerPositions: [], bosses: [], bossPositions: [] },
  { world: null, players: [], playerPositions: [], bosses: [], bossPositions: [] },
];
let interpolationBufferIndex = 0;

function ensurePlayerBuffer(buf: InterpolationBuffer, players: Player[]): void {
  let rebuild = buf.players.length !== players.length;
  if (!rebuild) {
    for (let i = 0; i < players.length; i++) {
      if (buf.players[i].id !== players[i].id) { rebuild = true; break; }
    }
  }
  if (rebuild) {
    buf.playerPositions = players.map(() => ({ x: 0, z: 0 }));
    buf.players = players.map((_, i) => ({ pos: buf.playerPositions[i] }) as Player);
  }
}

function ensureBossBuffer(buf: InterpolationBuffer, bosses: Boss[]): void {
  let rebuild = buf.bosses.length !== bosses.length;
  if (!rebuild) {
    for (let i = 0; i < bosses.length; i++) {
      if (buf.bosses[i].id !== bosses[i].id) { rebuild = true; break; }
    }
  }
  if (rebuild) {
    buf.bossPositions = bosses.map(() => ({ x: 0, z: 0 }));
    buf.bosses = bosses.map((_, i) => ({ pos: buf.bossPositions[i] }) as Boss);
  }
}

function interpolateWorld(prev: World, next: World, t: number): World {
  const buf = interpolationBuffers[interpolationBufferIndex];
  interpolationBufferIndex = (interpolationBufferIndex + 1) % interpolationBuffers.length;
  const prevIndex = getEntityIndex(prev);
  ensurePlayerBuffer(buf, next.players);
  ensureBossBuffer(buf, next.bosses);
  for (let i = 0; i < next.players.length; i++) {
    const player = next.players[i];
    buf.players[i].pos = buf.playerPositions[i];
    interpolatePlayerInto(buf.players[i], prevIndex.players.get(player.id), player, t);
  }
  for (let i = 0; i < next.bosses.length; i++) {
    const boss = next.bosses[i];
    buf.bosses[i].pos = buf.bossPositions[i];
    interpolateBossInto(buf.bosses[i], prevIndex.bosses.get(boss.id) ?? boss, boss, t);
  }
  const world = Object.assign(buf.world ?? ({} as World), next);
  buf.world = world;
  world.time = lerp(prev.time, next.time, t);
  world.players = buf.players;
  world.bosses = buf.bosses;
  world.boss = buf.bosses[0]!;
  const renderKeys = getWorldRenderKeys(next) ?? getWorldRenderKeys(prev);
  if (renderKeys) setWorldRenderKeys(world, renderKeys);
  return world;
}
