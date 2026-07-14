import { ColyseusTransport } from "./colyseusTransport";
import { type ClientMessage, type ServerMessage } from "@shared/protocol";
import type { Intent, World } from "@shared/types";
import { LocalPredictor } from "./predictor";
import { worldHash } from "@shared/worldHash";
import { WORLD_RENDER_KEYS, getWorldRenderKeys, setWorldRenderKeys } from "./worldRenderKeys";
import {
  PERF_ENABLED,
  recordApplyFrames,
  recordHostSnapshot,
  recordResyncRequest,
} from "./perfMetrics";
import { SNAPSHOT_FORMAT_VERSION } from "@shared/replay";
import { SimulationReplica } from "./simulationReplica";
import { RenderSnapshotBuffer } from "./renderSnapshotBuffer";

export interface Transport {
  open(): Promise<void>;
  send(message: ClientMessage): boolean;
  onMessage(cb: (message: ServerMessage) => void): void;
  onReconnect(cb: () => void): void;
  close(): void;
}

type MessageType = ServerMessage["type"];
type Handler<T extends MessageType> = (message: Extract<ServerMessage, { type: T }>) => void;

// Report a world hash this often (in ticks) so the server can detect cross-client desync.
const HASH_INTERVAL = 300;
// Host sends a world snapshot this often; replay tail on late join is bounded by this interval.
const SNAPSHOT_INTERVAL = 600;

export class NetClient {
  clientId: string | null = null;

  private readonly handlers = new Map<MessageType, Set<(message: ServerMessage) => void>>();
  private readonly replica = new SimulationReplica();
  private readonly renderBuffer = new RenderSnapshotBuffer();
  private lastJoin: { sessionId: string; raidId: string } | null = null;
  private claimedPlayerId: string | null = null;
  private observing = false;
  private isHost = false;
  private readonly predictor = new LocalPredictor();
  // True only while the pull is actively relaying frames (playing). Pause/stop/done leave the local
  // world's status as "running", so this gates local prediction so the player can't nudge while the
  // sim is halted. Set on frame arrival, cleared on a non-playing playback state or a fresh `started`.
  private playing = false;
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
      this.observing = true;
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

  getRenderView(now: number, predict?: { intent: Intent; dt: number }): World | null {
    const view = this.renderBuffer.getView(now);
    if (!view) return null;
    return predict ? this.applyPrediction(view, predict.intent, predict.dt) : view;
  }

  // Override the local player in the render view with a client-predicted position so the user's own
  // movement is instant. Render-only: anchors to the replica's latest authoritative world and
  // never mutates `view` (which may be a stored snapshot) — a new players array is built instead.
  private applyPrediction(view: World, intent: Intent, dt: number): World {
    // Only predict while the pull is live. Paused/stopped/done leave world.status === "running" but
    // halt the relay, so without `playing` the player could nudge the frozen character around.
    const authoritative = this.replica.world;
    if (!this.playing || !this.claimedPlayerId || !authoritative || authoritative.status !== "running") return view;
    const authLocal = authoritative.players.find(p => p.id === this.claimedPlayerId);
    if (!authLocal) return view;

    const predicted = this.predictor.predict(authLocal, authoritative.arena.zones, authoritative.time, intent, dt);
    const localIndex = view.players.findIndex(p => p.id === this.claimedPlayerId);
    if (localIndex === -1) return view;
    const players = view.players.slice();
    players[localIndex] = {
      ...players[localIndex],
      pos: predicted.pos,
      facing: predicted.facing,
      y: predicted.y,
    };
    const world = { ...view, players };
    const renderKeys = getWorldRenderKeys(view);
    if (renderKeys) setWorldRenderKeys(world, renderKeys);
    return world;
  }

  close(): void {
    this.transport.close();
  }

  private resumeSession(): void {
    if (!this.lastJoin) return;
    this.renderBuffer.reset();
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
      this.claimedPlayerId = message.slots.find(slot => slot.claimedByYou || slot.queuedByYou)?.playerId ?? null;
      this.observing = message.observingByYou || message.observerQueuedByYou;
      this.isHost = this.clientId !== null && this.clientId === message.hostClientId;
      this.predictor.reset();
    }
    if (message.type === "playback") {
      this.isHost = this.clientId !== null && this.clientId === message.hostClientId;
      this.playing = message.state === "playing";
      this.predictor.reset();
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
      this.playing = false;
      this.predictor.reset();
    }

    const handlers = this.handlers.get(message.type as MessageType);
    if (!handlers) return;
    for (const handler of handlers) handler(message);
  }

  // Adopt the pull's world at baseTick and fast-forward by replaying only the tail frames so a fresh
  // start lands at tick 0 and a late join / resync lands exactly where the rest of the room is.
  private applyStarted(message: Extract<ServerMessage, { type: "started" }>): void {
    const world = this.replica.adopt(message.world, message.baseTick, message.frames);
    this.simEndedSent = false;
    this.playing = false; // re-enabled by the first frame if this pull is actually live (not a stop/late-join into a halted pull)
    this.predictor.reset();
    this.renderBuffer.start(world, this.replica.appliedTick);
  }

  // Apply an incremental run of input frames. `startTick` lets us drop already-applied frames (after
  // a resync) and detect a gap (missed frames) that warrants a full resync via rejoin.
  private applyFrames(message: Extract<ServerMessage, { type: "frames" }>): void {
    if (!this.replica.world) return;
    const start = performance.now();
    const result = this.replica.apply(message.startTick, message.frames);
    if (result.kind === "gap") { recordResyncRequest(); this.resumeSession(); return; }
    this.playing = true; // frames are flowing → the pull is live; local prediction is allowed
    for (const snapshot of result.snapshots) {
      this.renderBuffer.push(snapshot.world, snapshot.tick);
      this.maybeReportHash();
      this.maybeReportSnapshot();
    }
    this.maybeReportSimEnded();
    recordApplyFrames(message.frames.length, result.applied, performance.now() - start);
  }

  private maybeReportSnapshot(): void {
    const replicaWorld = this.replica.world;
    const appliedTick = this.replica.appliedTick;
    if (!this.isHost || !replicaWorld || appliedTick === 0 || appliedTick % SNAPSHOT_INTERVAL !== 0) return;
    // Explicitly drop the render-keys symbol: object spread copies enumerable symbol keys (the
    // render buffer attaches it to replica worlds), and although JSON.stringify would drop it on send,
    // strip it here so `world` is clean.
    const { [WORLD_RENDER_KEYS]: _drop, ...world } = replicaWorld as any;
    const message = { type: "snapshot", formatVersion: SNAPSHOT_FORMAT_VERSION, tick: appliedTick, world } as const;
    if (PERF_ENABLED) {
      const start = performance.now();
      const bytes = JSON.stringify(message).length;
      recordHostSnapshot(performance.now() - start, bytes);
    }
    this.send(message);
  }

  // Report on fixed tick boundaries (not a per-client delta) so every client hashes the SAME ticks.
  // Each client steps every tick, so alignment is guaranteed and the server can actually compare.
  private maybeReportHash(): void {
    const world = this.replica.world;
    const appliedTick = this.replica.appliedTick;
    if (!world || appliedTick === 0 || appliedTick % HASH_INTERVAL !== 0) return;
    this.send({ type: "worldHash", tick: appliedTick, hash: worldHash(world) });
  }

  private maybeReportSimEnded(): void {
    const world = this.replica.world;
    if (!this.isHost || this.simEndedSent || !world || world.status === "running") return;
    this.simEndedSent = true;
    this.send({ type: "simEnded", tick: this.replica.appliedTick });
  }
}

export async function connect(): Promise<NetClient> {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const client = new NetClient(new ColyseusTransport(`${protocol}//${location.host}`));
  await client.open();
  return client;
}
