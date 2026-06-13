import { type ClientMessage, type Frame, type ServerMessage } from "@shared/protocol";
import type { Boss, Player, World } from "@shared/types";
import { shortestAngleDelta } from "@shared/math";
import { tick } from "../engine/sim";
import { computeBotIntents } from "../engine/botIntent";
import { worldHash } from "@shared/worldHash";
import { computeWorldRenderKeys, getWorldRenderKeys, setWorldRenderKeys, type WorldRenderKeys } from "./worldRenderKeys";

type MessageType = ServerMessage["type"];
type Handler<T extends MessageType> = (message: Extract<ServerMessage, { type: T }>) => void;

const DT = 1 / 60;
const RENDER_DELAY_MS = 33;
const SNAPSHOT_BUFFER_MAX = 32;
const SNAPSHOT_GAP_RESET_MS = 250;
const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 8000;
// Report a world hash this often (in ticks) so the server can detect cross-client desync.
const HASH_INTERVAL = 300;

type Snapshot = { t: number; world: World };

// Server-relayed deterministic lockstep: every client runs the engine locally. The server sends the
// initial world plus a stream of input frames; stepping `tick()` from the same seed + frames yields
// a byte-identical world on every client. No world snapshots are ever sent during play.
export class NetClient {
  clientId: string | null = null;

  private ws: WebSocket | null = null;
  private readonly handlers = new Map<MessageType, Set<(message: ServerMessage) => void>>();
  private readonly snapshots: Snapshot[] = [];
  private lastJoin: { sessionId: string; raidId: string } | null = null;
  private claimedPlayerId: string | null = null;
  private observing = false;
  private closing = false;
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private worldRenderKeys: WorldRenderKeys | null = null;

  // Local simulation state.
  private world: World | null = null;
  private appliedTick = 0;       // number of input frames applied == current sim tick
  private isHost = false;
  private simEndedSent = false;  // host: simEnded already reported for this pull

  constructor(private readonly url: string) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.attachSocket();
      ws.addEventListener("open", () => {
        resolve();
      }, { once: true });
      ws.addEventListener("error", () => {
        reject(new Error("Failed to connect to server"));
      }, { once: true });
    });
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

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
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
    if (buf.length === 1) return buf[0].world;

    const target = now - RENDER_DELAY_MS;
    if (target <= buf[0].t) return buf[0].world;
    if (target >= buf[buf.length - 1].t) return buf[buf.length - 1].world;

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
    this.closing = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
  }

  private attachSocket(): WebSocket {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener("message", event => this.handleMessage(event));
    ws.addEventListener("close", () => this.onClose());
    return ws;
  }

  private onClose(): void {
    this.ws = null;
    this.clientId = null;
    if (this.closing) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closing || !this.lastJoin) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const ws = this.attachSocket();
      ws.addEventListener("open", () => {
        this.reconnectDelay = RECONNECT_INITIAL_MS;
        this.resumeSession();
      }, { once: true });
    }, delay);
  }

  private resumeSession(): void {
    if (!this.lastJoin) return;
    this.snapshots.length = 0;
    const join = this.lastJoin;
    const claim = this.claimedPlayerId;
    const observing = this.observing;
    this.send({ type: "join", sessionId: join.sessionId, raidId: join.raidId });
    if (claim) this.send({ type: "claimSlot", playerId: claim });
    if (observing) this.send({ type: "claimObserver" });
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") return;

    let message: ServerMessage;
    try {
      message = JSON.parse(event.data) as ServerMessage;
    } catch {
      return;
    }
    if (!message || typeof message.type !== "string") return;

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
    }

    const handlers = this.handlers.get(message.type as MessageType);
    if (!handlers) return;
    for (const handler of handlers) handler(message);
  }

  // Adopt the pull's initial world and fast-forward by replaying the supplied input log so a fresh
  // start lands at tick 0 and a late join / resync lands exactly where the rest of the room is.
  private applyStarted(message: Extract<ServerMessage, { type: "started" }>): void {
    this.worldRenderKeys = computeWorldRenderKeys(message.world);
    this.world = message.world;
    this.appliedTick = 0;
    this.simEndedSent = false;
    for (const frame of message.frames) this.stepOne(frame);
    this.snapshots.length = 0;
    this.pushSnapshot(this.world);
  }

  // Apply an incremental run of input frames. `startTick` lets us drop already-applied frames (after
  // a resync) and detect a gap (missed frames) that warrants a full resync via rejoin.
  private applyFrames(message: Extract<ServerMessage, { type: "frames" }>): void {
    if (!this.world) return;
    const offset = this.appliedTick - message.startTick;
    if (offset < 0) { this.resumeSession(); return; } // gap: missed frames, resync from scratch
    for (let i = offset; i < message.frames.length; i++) {
      this.stepOne(message.frames[i]);
      this.pushSnapshot(this.world);
      this.maybeReportHash();
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

  private pushSnapshot(world: World): void {
    const now = performance.now();
    const last = this.snapshots[this.snapshots.length - 1];
    if (last && now - last.t > SNAPSHOT_GAP_RESET_MS) this.snapshots.length = 0;
    if (!this.worldRenderKeys) this.worldRenderKeys = computeWorldRenderKeys(world);
    setWorldRenderKeys(world, this.worldRenderKeys);
    this.snapshots.push({ t: now, world });
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
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const client = new NetClient(`${protocol}//${location.host}`);
  await client.open();
  return client;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + shortestAngleDelta(a, b) * t;
}

function interpolatePlayer(prev: Player | undefined, next: Player, t: number): Player {
  if (!prev) return next;
  return {
    ...next,
    pos: { x: lerp(prev.pos.x, next.pos.x, t), z: lerp(prev.pos.z, next.pos.z, t) },
    y: lerp(prev.y, next.y, t),
    facing: lerpAngle(prev.facing, next.facing, t),
  };
}

function interpolateBoss(prev: Boss, next: Boss, t: number): Boss {
  return {
    ...next,
    pos: { x: lerp(prev.pos.x, next.pos.x, t), z: lerp(prev.pos.z, next.pos.z, t) },
    facing: lerpAngle(prev.facing, next.facing, t), // smooth turning (sim snaps per tick)
  };
}

function interpolateWorld(prev: World, next: World, t: number): World {
  const prevById = new Map(prev.players.map(p => [p.id, p]));
  const world = {
    ...next,
    time: lerp(prev.time, next.time, t),
    players: next.players.map(playerB => interpolatePlayer(prevById.get(playerB.id), playerB, t)),
    boss: interpolateBoss(prev.boss, next.boss, t),
  };
  const renderKeys = getWorldRenderKeys(next) ?? getWorldRenderKeys(prev);
  if (renderKeys) setWorldRenderKeys(world, renderKeys);
  return world;
}
