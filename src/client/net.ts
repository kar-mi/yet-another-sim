import { ColyseusTransport } from "./colyseusTransport";
import { type ClientMessage, type ReplayView, type ServerMessage } from "@model/protocol";
import type { Intent, World } from "@model/types";
import { LocalPredictor } from "./predictor";
import { worldHash } from "@model/worldHash";
import { WORLD_RENDER_KEYS, getWorldRenderKeys, setWorldRenderKeys } from "./worldRenderKeys";
import {
  PERF_ENABLED,
  recordApplyFrames,
  recordHostSnapshot,
  recordResyncRequest,
} from "./perfMetrics";
import { SNAPSHOT_FORMAT_VERSION } from "@model/replay";
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

const HASH_INTERVAL = 300;
const SNAPSHOT_INTERVAL = 600;

export class NetClient {
  participantId: string | null = null;
  replayView: ReplayView | null = null;

  private readonly handlers = new Map<MessageType, Set<(message: ServerMessage) => void>>();
  private readonly replica = new SimulationReplica();
  private readonly renderBuffer = new RenderSnapshotBuffer();
  private lastJoin: { sessionId: string; raidId: string; participantId: string } | null = null;
  private claimedPlayerId: string | null = null;
  private isHost = false;
  private readonly predictor = new LocalPredictor();
  private playing = false;
  private simEndedSent = false;

  constructor(private readonly transport: Transport) {
    transport.onMessage(message => this.handleMessage(message));
    transport.onReconnect(() => this.resumeSession());
  }

  open(): Promise<void> {
    return this.transport.open();
  }

  send(message: ClientMessage): boolean {
    if (message.type === "join") {
      this.lastJoin = { sessionId: message.sessionId, raidId: message.raidId, participantId: message.participantId };
    }
    if (message.type === "claimSlot") this.claimedPlayerId = message.playerId;
    if (message.type === "releaseSlot" && this.claimedPlayerId === message.playerId) this.claimedPlayerId = null;
    if (message.type === "claimObserver") this.claimedPlayerId = null;

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

  private applyPrediction(view: World, intent: Intent, dt: number): World {
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
    this.send({ type: "join", ...this.lastJoin });
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === "joined") {
      this.participantId = message.participantId;
    }
    if (message.type === "lobby") {
      this.claimedPlayerId = message.slots.find(slot => slot.claimedByYou || slot.queuedByYou)?.playerId ?? null;
      this.isHost = this.participantId !== null && this.participantId === message.hostParticipantId;
      this.predictor.reset();
    }
    if (message.type === "playback") {
      this.isHost = this.participantId !== null && this.participantId === message.hostParticipantId;
      this.playing = message.state === "playing";
      this.predictor.reset();
    }
    if (message.type === "started") {
      this.claimedPlayerId = message.yourPlayerId;
      this.applyStarted(message);
    } else if (message.type === "frames") {
      this.applyFrames(message);
    } else if (message.type === "replay") {
      this.replayView = message.view;
    } else if (message.type === "sessionExpired") {
      this.replayView = null;
      this.lastJoin = null;
      this.claimedPlayerId = null;
      this.isHost = false;
      this.playing = false;
      this.predictor.reset();
    }

    const handlers = this.handlers.get(message.type as MessageType);
    if (!handlers) return;
    for (const handler of handlers) handler(message);
  }

  private applyStarted(message: Extract<ServerMessage, { type: "started" }>): void {
    const world = this.replica.adopt(message.world, message.baseTick, message.frames);
    this.simEndedSent = false;
    this.playing = false;
    this.predictor.reset();
    this.renderBuffer.start(world, this.replica.appliedTick);
  }

  private applyFrames(message: Extract<ServerMessage, { type: "frames" }>): void {
    if (!this.replica.world) return;
    const start = performance.now();
    const result = this.replica.apply(message.startTick, message.frames);
    if (result.kind === "gap") { recordResyncRequest(); this.resumeSession(); return; }
    this.playing = true;
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
    const { [WORLD_RENDER_KEYS]: _drop, ...world } = replicaWorld as any;
    const message = { type: "snapshot", formatVersion: SNAPSHOT_FORMAT_VERSION, tick: appliedTick, world } as const;
    if (PERF_ENABLED) {
      const start = performance.now();
      const bytes = JSON.stringify(message).length;
      recordHostSnapshot(performance.now() - start, bytes);
    }
    this.send(message);
  }

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
