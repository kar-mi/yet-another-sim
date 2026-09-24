import { Room, type AuthContext, type Client } from "@colyseus/core";
import { ClientMessageSchema, EMPTY_RAID_ID, ParticipantIdSchema, RaidIdSchema, SessionIdSchema, type ServerMessage } from "@model/protocol";
import { logger, createSessionLog } from "./logger";
import { RAIDS_DIR } from "./raidCatalog";
import { isOriginAllowed, parseAllowedOrigins } from "./origin";
import { ConnectionCounter, clientIpFor, createMessageRateLimiter, type RateLimiter } from "./rateLimit";
import { loadSessionRaid } from "./sessionRaid";
import { metrics } from "./metrics";
import { RelayRoom } from "./relayRoom";

function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be positive integer`);
  return value;
}

export const MAX_SESSIONS = parsePositiveInt("MAX_SESSIONS", Bun.env.MAX_SESSIONS, 10);
const MAX_CONNECTIONS_PER_IP = parsePositiveInt("MAX_CONNECTIONS_PER_IP", Bun.env.MAX_CONNECTIONS_PER_IP, 30);
const MAX_WS_MSGS_PER_SEC = parsePositiveInt("MAX_WS_MSGS_PER_SEC", Bun.env.MAX_WS_MSGS_PER_SEC, 120);

const ALLOWED_ORIGINS = parseAllowedOrigins(Bun.env.ALLOWED_ORIGINS);
const ipConnections = new ConnectionCounter(MAX_CONNECTIONS_PER_IP);
let connectedClients = 0;
let activeRooms = 0;

function headerValue(headers: AuthContext["headers"], name: string): string | undefined {
  return headers.get(name) ?? undefined;
}

export function relayClientsConnected(): number {
  return connectedClients;
}

export function relayRoomsActive(): number {
  return activeRooms;
}

interface RelayClientData {
  ip?: string;
  counted?: boolean;
  rate?: RateLimiter;
  participantId?: string;
}

export interface RelayRoomOptions {
  sessionId?: string;
  raidId?: string;
  participantId?: string;
}

export interface RelayServerDependencies {
  autoTick?: boolean;
  now?: () => number;
  lobbyTimeoutMs?: number;
  loadRaid?: typeof loadSessionRaid;
}

// Colyseus room adapter: owns a transport-agnostic RelayRoom and wires Colyseus lifecycle, auth,
// rate limiting, and message routing into it.
export class RelayServerRoom extends Room {
  private readonly relay: RelayRoom;
  private readonly dependencies: RelayServerDependencies;
  private capacityReserved = false;
  private messageQueue = Promise.resolve();

  constructor(dependencies: RelayServerDependencies = {}) {
    super();
    this.dependencies = dependencies;
    this.relay = new RelayRoom();
  }

  async onCreate(options: RelayRoomOptions): Promise<void> {
    const sessionId = typeof options.sessionId === "string" && options.sessionId ? options.sessionId : this.roomId;
    const raidId = typeof options.raidId === "string" && options.raidId ? options.raidId : EMPTY_RAID_ID;
    if (options.sessionId && !SessionIdSchema.safeParse(sessionId).success) throw new Error("Invalid sessionId");
    if (!RaidIdSchema.safeParse(raidId).success) throw new Error("Invalid raidId");
    if (activeRooms >= MAX_SESSIONS) throw new Error("Server is full");
    activeRooms++;
    this.capacityReserved = true;
    try {
      await this.setMetadata({ sessionId } as any);
      this.relay.init({
        id: sessionId,
        raidId,
        raid: await (this.dependencies.loadRaid ?? loadSessionRaid)(raidId, RAIDS_DIR),
        autoTick: this.dependencies.autoTick,
        now: this.dependencies.now,
        lobbyTimeoutMs: this.dependencies.lobbyTimeoutMs,
        createSessionLog,
        send: (clientId, message) => this.clients.getById(clientId)?.send("s", message),
      });
      this.onMessage("c", (client, message) => this.handleColyseusMessage(client, message));
      this.clock.setInterval(() => {
        if (!this.relay.isExpired()) return;
        for (const client of this.clients) client.send("s", { type: "sessionExpired" } satisfies ServerMessage);
        this.disconnect();
      }, 60_000);
    } catch (error) {
      this.releaseCapacity();
      throw error;
    }
  }

  onAuth(client: Client<{ userData: RelayClientData }>, options: RelayRoomOptions, context: AuthContext): boolean {
    const participantId = ParticipantIdSchema.safeParse(options.participantId);
    if (!participantId.success) return false;
    const origin = headerValue(context.headers, "origin");
    const host = headerValue(context.headers, "host") ?? "localhost";
    const requestUrl = "http://" + host + "/";
    if (!isOriginAllowed(origin ?? null, requestUrl, ALLOWED_ORIGINS)) return false;
    const ip = clientIpFor(headerValue(context.headers, "x-forwarded-for") ?? null, Array.isArray(context.ip) ? context.ip[0] : context.ip);
    client.userData = { ip, rate: createMessageRateLimiter(MAX_WS_MSGS_PER_SEC), participantId: participantId.data };
    return true;
  }

  onJoin(client: Client<{ userData: RelayClientData }>): void {
    const ip = client.userData?.ip ?? "unknown";
    if (!ipConnections.tryAcquire(ip)) {
      client.leave(4008, "Too many connections");
      return;
    }
    const participantId = client.userData?.participantId;
    if (!participantId) {
      client.leave(4009, "Missing participant id");
      return;
    }
    client.userData = { ...client.userData, ip, counted: true };
    connectedClients++;
    client.send("s", { type: "joined", participantId } satisfies ServerMessage);
    this.relay.join(client.sessionId, participantId);
  }

  onLeave(client: Client<{ userData: RelayClientData }>): void {
    if (!client.userData?.counted) return;
    connectedClients = Math.max(0, connectedClients - 1);
    if (client.userData.ip) ipConnections.release(client.userData.ip);
    this.relay.disconnectClient(client.sessionId);
  }

  onDispose(): void {
    this.releaseCapacity();
    this.relay.dispose();
  }

  private releaseCapacity(): void {
    if (!this.capacityReserved) return;
    this.capacityReserved = false;
    activeRooms = Math.max(0, activeRooms - 1);
  }

  private handleColyseusMessage(client: Client<{ userData: RelayClientData }>, raw: unknown): void {
    metrics.wsMessagesTotal.inc();
    const rate = client.userData?.rate;
    if (rate && !rate.allow()) {
      metrics.wsRateLimitedTotal.inc();
      return;
    }
    const parsed = ClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      metrics.wsInvalidTotal.inc();
      logger.warn("net", "invalid message", { clientId: client.sessionId });
      client.send("s", { type: "error", message: "Invalid message" } satisfies ServerMessage);
      return;
    }
    this.messageQueue = this.messageQueue.then(async () => {
      if (parsed.data.type === "debugPosition") {
        logger.debug("hud", "player position", { clientId: client.sessionId, ...parsed.data });
        return;
      }
      try {
        const participantId = client.userData?.participantId;
        if (!participantId) return;
        if (parsed.data.type === "join") {
          this.relay.touch();
          this.relay.sendLobby(participantId);
          this.relay.sendReplay(participantId);
          return;
        }
        if (parsed.data.type === "setRaid") {
          this.relay.setRaid(participantId, parsed.data.raidId, await (this.dependencies.loadRaid ?? loadSessionRaid)(parsed.data.raidId, RAIDS_DIR));
          return;
        }
        if (parsed.data.type === "setBotPattern") {
          const raid = await (this.dependencies.loadRaid ?? loadSessionRaid)(this.relay.selectedRaidId, RAIDS_DIR, parsed.data.patternId);
          this.relay.setBotPattern(participantId, parsed.data.patternId, raid);
          return;
        }
        this.relay.handle(participantId, parsed.data);
      } catch (err) {
        logger.error("net", "message handler failed", { clientId: client.sessionId, type: parsed.data.type, err });
        client.send("s", { type: "error", message: "Server error" } satisfies ServerMessage);
      }
    });
  }
}
