import { Room, type AuthContext, type Client } from "colyseus";
import { ClientMessageSchema, EMPTY_RAID_ID, type ServerMessage } from "@shared/protocol";
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
export const MAX_CONNECTIONS_PER_IP = parsePositiveInt("MAX_CONNECTIONS_PER_IP", Bun.env.MAX_CONNECTIONS_PER_IP, 30);
export const MAX_WS_MSGS_PER_SEC = parsePositiveInt("MAX_WS_MSGS_PER_SEC", Bun.env.MAX_WS_MSGS_PER_SEC, 120);

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
}

export interface RelayRoomOptions {
  sessionId?: string;
  raidId?: string;
  autoTick?: boolean;
  now?: () => number;
  lobbyTimeoutMs?: number;
}

// Colyseus room adapter: owns a transport-agnostic RelayRoom and wires colyseus lifecycle, auth,
// rate limiting, and message routing into it. Keeping the relay logic out of this class
// is what lets the static (loopback) client reuse RelayRoom without pulling colyseus into the browser.
export class RelayServerRoom extends Room {
  private readonly relay = new RelayRoom();

  async onCreate(options: RelayRoomOptions): Promise<void> {
    const sessionId = typeof options.sessionId === "string" && options.sessionId ? options.sessionId : this.roomId;
    const raidId = typeof options.raidId === "string" && options.raidId ? options.raidId : EMPTY_RAID_ID;
    if (activeRooms >= MAX_SESSIONS) throw new Error("Server is full");
    activeRooms++;
    await this.setMetadata({ sessionId } as any);
    this.relay.init({
      id: sessionId,
      raidId,
      raid: await loadSessionRaid(raidId, RAIDS_DIR),
      autoTick: options.autoTick,
      now: options.now,
      lobbyTimeoutMs: options.lobbyTimeoutMs,
      createSessionLog,
      send: (clientId, message) => {
        const payload = typeof message === "string" ? JSON.parse(message) as ServerMessage : message;
        this.clients.getById(clientId)?.send("s", payload);
      },
    });
    this.onMessage("c", (client, message) => this.handleColyseusMessage(client, message));
    this.clock.setInterval(() => {
      if (!this.relay.isExpired()) return;
      for (const client of this.clients) client.send("s", { type: "sessionExpired" } satisfies ServerMessage);
      this.disconnect();
    }, 60_000);
  }

  onAuth(client: Client<{ userData: RelayClientData }>, _options: RelayRoomOptions, context: AuthContext): boolean {
    const origin = headerValue(context.headers, "origin");
    const host = headerValue(context.headers, "host") ?? "localhost";
    const requestUrl = "http://" + host + "/";
    if (!isOriginAllowed(origin ?? null, requestUrl, ALLOWED_ORIGINS)) return false;
    const ip = clientIpFor(headerValue(context.headers, "x-forwarded-for") ?? null, Array.isArray(context.ip) ? context.ip[0] : context.ip);
    client.userData = { ip, rate: createMessageRateLimiter(MAX_WS_MSGS_PER_SEC) };
    return true;
  }

  onJoin(client: Client<{ userData: RelayClientData }>): void {
    const ip = client.userData?.ip ?? "unknown";
    if (!ipConnections.tryAcquire(ip)) {
      client.leave(4008, "Too many connections");
      return;
    }
    client.userData = { ...client.userData, ip, counted: true };
    connectedClients++;
    client.send("s", { type: "joined", clientId: client.sessionId } satisfies ServerMessage);
    this.relay.join(client.sessionId);
  }

  onLeave(client: Client<{ userData: RelayClientData }>): void {
    if (!client.userData?.counted) return;
    connectedClients = Math.max(0, connectedClients - 1);
    if (client.userData.ip) ipConnections.release(client.userData.ip);
    this.relay.disconnectClient(client.sessionId);
  }

  onDispose(): void {
    activeRooms = Math.max(0, activeRooms - 1);
    this.relay.dispose();
  }

  private handleColyseusMessage(client: Client<{ userData: RelayClientData }>, raw: unknown): void {
    void (async () => {
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
      if (parsed.data.type === "debugPosition") {
        logger.debug("hud", "player position", { clientId: client.sessionId, ...parsed.data });
        return;
      }
      try {
        if (parsed.data.type === "join") {
          this.relay.touch();
          this.relay.sendLobby(client.sessionId);
          return;
        }
        if (parsed.data.type === "setRaid") {
          this.relay.setRaid(client.sessionId, parsed.data.raidId, await loadSessionRaid(parsed.data.raidId, RAIDS_DIR));
          return;
        }
        this.relay.handle(client.sessionId, parsed.data);
      } catch (err) {
        logger.error("net", "message handler failed", { clientId: client.sessionId, type: parsed.data.type, err });
        client.send("s", { type: "error", message: "Server error" } satisfies ServerMessage);
      }
    })();
  }
}
