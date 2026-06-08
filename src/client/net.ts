import type { ClientMessage, ServerMessage } from "../shared/protocol";
import type { Boss, Player, World } from "../shared/types";

type MessageType = ServerMessage["type"];
type Handler<T extends MessageType> = (message: Extract<ServerMessage, { type: T }>) => void;

const RENDER_DELAY_MS = 33;
const SNAPSHOT_BUFFER_MAX = 32;
const SNAPSHOT_GAP_RESET_MS = 250;
const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 8000;

type Snapshot = { t: number; world: World };

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

  constructor(private readonly url: string) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.attachSocket();
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("Failed to connect to server")), { once: true });
    });
  }

  send(message: ClientMessage): void {
    if (message.type === "join") this.lastJoin = { sessionId: message.sessionId, raidId: message.raidId };
    if (message.type === "claimSlot") this.claimedPlayerId = message.playerId;
    if (message.type === "releaseSlot" && this.claimedPlayerId === message.playerId) this.claimedPlayerId = null;
    if (message.type === "claimObserver") {
      this.claimedPlayerId = null;
    }
    if (message.type === "releaseObserver") this.observing = false;

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
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

    if (message.type === "joined") this.clientId = message.clientId;
    if (message.type === "lobby") {
      this.claimedPlayerId = message.slots.find(slot => slot.claimedByYou)?.playerId ?? null;
      this.observing = message.observingByYou;
    }
    if (message.type === "started") {
      this.claimedPlayerId = message.yourPlayerId;
      this.observing = message.yourPlayerId === null;
    }
    if (message.type === "started" || message.type === "snapshot" || message.type === "playback") this.pushSnapshot(message.world);

    const handlers = this.handlers.get(message.type as MessageType);
    if (!handlers) return;
    for (const handler of handlers) handler(message);
  }

  private pushSnapshot(world: World): void {
    const now = performance.now();
    const last = this.snapshots[this.snapshots.length - 1];
    if (last && now - last.t > SNAPSHOT_GAP_RESET_MS) this.snapshots.length = 0;
    this.snapshots.push({ t: now, world });
    if (this.snapshots.length > SNAPSHOT_BUFFER_MAX) this.snapshots.shift();
  }
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
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
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
  return {
    ...next,
    time: lerp(prev.time, next.time, t),
    players: next.players.map(playerB => interpolatePlayer(prevById.get(playerB.id), playerB, t)),
    boss: interpolateBoss(prev.boss, next.boss, t),
  };
}
