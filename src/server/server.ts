import { addServerTraceEvent, recordServerException, withServerSpan } from "./otel";
import { Buffer } from "node:buffer";
import { join } from "path";
import {
  ClientMessageSchema,
  type ServerMessage,
} from "@shared/protocol";
import { SessionManager, capacitySnapshot } from "./session";
import { logger, createSessionLog, isDevelopment } from "./logger";
import { metrics } from "./metrics";
import { startMetricsServer } from "./metricsServer";
import { isOriginAllowed, parseAllowedOrigins } from "./origin";
import { ConnectionCounter, clientIpFor, createMessageRateLimiter, type RateLimiter } from "./rateLimit";
import { getRaidCategories, raidCatalogCacheControl, RAIDS_DIR } from "./raidCatalog";

const ROOT = join(import.meta.dir, "..", "..");
const BUNDLE_DIR = join(ROOT, ".bundle");
const STATIC_DIR = join(ROOT, "static");
const PORT = Number(Bun.env.PORT || 3000);
const ALLOWED_ORIGINS = parseAllowedOrigins(Bun.env.ALLOWED_ORIGINS);

// Maximum allocated rooms on this backend. A bad cap must fail startup, never be
// silently coerced into an unbounded or nonsensical limit.
function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    logger.error("config", `${name} must be a positive integer`, { value: raw });
    process.exit(1);
  }
  return value;
}
const MAX_SESSIONS = parsePositiveInt("MAX_SESSIONS", Bun.env.MAX_SESSIONS, 10);

// Per-IP WebSocket connection cap so one client can't open enough sockets to exhaust the
// room pool. Default tolerates NAT/shared IPs (the pool is already bounded by MAX_SESSIONS).
const MAX_CONNECTIONS_PER_IP = parsePositiveInt("MAX_CONNECTIONS_PER_IP", Bun.env.MAX_CONNECTIONS_PER_IP, 16);

// Per-connection inbound message-rate cap (messages/second). Sits well above normal play —
// intents are sent only on change at the display refresh rate plus host snapshot/hash — so it
// only trips on a flood. Over-limit messages are dropped, not disconnected.
const MAX_WS_MSGS_PER_SEC = parsePositiveInt("MAX_WS_MSGS_PER_SEC", Bun.env.MAX_WS_MSGS_PER_SEC, 300);

// Client->server messages (intents, joins, claims) are all tiny, so cap accepted WS payloads well
// below Bun's ~16 MB default to cheaply reject abusive oversized frames. This bounds ingress only;
// the large outbound resync (full input log) is not governed by it.
const MAX_WS_PAYLOAD_BYTES = 1 << 20; // 1 MiB

// Only large one-shot payloads (the full-input-log resync on late join / reconnect) are worth
// compressing. The tiny 60 Hz frame stream is pure compress/decompress latency under
// perMessageDeflate, so anything below this is sent uncompressed (Bun's per-send compress flag).
const WS_COMPRESS_THRESHOLD = 8192;

// Baseline defense-in-depth headers on served HTML/assets. CSP is kept in-app because it is
// coupled to index.html: the Google Fonts hosts are allow-listed and ws:/wss: covers the
// WebSocket connection. style-src omits 'unsafe-inline' — index.html carries no inline style=""
// attributes and runtime styling uses CSSOM property setters (el.style.x), which CSP permits. The
// WebGL renderer compiles shaders GPU-side (no JS eval), so script-src stays 'self' with no
// 'unsafe-eval'. frame-ancestors 'none' replaces X-Frame-Options against clickjacking.
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
};

function withSecurityHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}

interface SocketData {
  clientId: string;
  ip: string;
  rate: RateLimiter;
}

// Reused across all inbound binary frames; allocating a TextDecoder per message is needless churn.
const wsTextDecoder = new TextDecoder();

logger.info("build", "building client bundle");
const buildResult = await Bun.build({
  entrypoints: [join(ROOT, "index.html")],
  outdir: BUNDLE_DIR,
  target: "browser",
  sourcemap: isDevelopment ? "inline" : "none",
  env: "disable",
  // Babylon registers engine extensions, scene-loader plugins (glTF), and material shaders via
  // side-effect modules that @babylonjs/core marks as tree-shakeable (sideEffects allow-list +
  // __PURE__ annotations). Bun's DCE strips the ones it can't see referenced, and how much it
  // strips varies by Bun version — so a build can silently lose rendering (no player models,
  // opaque "transparent" materials) in one environment but not another. Ignoring those annotations
  // keeps every side-effect registration without disabling real dead-code elimination; the bundle
  // grows ~2%. This is the single switch that prevents per-feature registration whack-a-mole.
  ignoreDCEAnnotations: true,
  define: {
    __YAS_DEBUG__: JSON.stringify(isDevelopment),
    __YAS_STATIC__: "false",
  },
});

if (!buildResult.success) {
  for (const log of buildResult.logs) logger.error("build", String(log));
  process.exit(1);
}
logger.info("build", "bundle ready");

const clients = new Map<string, Bun.ServerWebSocket<SocketData>>();
const ipConnections = new ConnectionCounter(MAX_CONNECTIONS_PER_IP);
let maxOutboundPayloadBytes = 0;
const manager = new SessionManager({
  raidsDir: RAIDS_DIR,
  send(clientId: string, message: ServerMessage | string) {
    const ws = clients.get(clientId);
    if (ws?.readyState !== WebSocket.OPEN) return;
    const payload = typeof message === "string" ? message : JSON.stringify(message);
    const payloadBytes = Buffer.byteLength(payload);
    metrics.wsOutboundPayloadBytesLast.set(payloadBytes);
    if (payloadBytes > maxOutboundPayloadBytes) {
      maxOutboundPayloadBytes = payloadBytes;
      metrics.wsOutboundPayloadBytesMax.set(payloadBytes);
    }
    ws.send(payload, payload.length > WS_COMPRESS_THRESHOLD);
  },
  createSessionLog,
  maxSessions: MAX_SESSIONS,
});
setInterval(() => manager.pruneExpired(), 60_000);

startMetricsServer({
  sessionsActive: () => manager.sessions.size,
  clientsConnected: () => clients.size,
  sessionsCapacity: MAX_SESSIONS,
});

const server = Bun.serve<SocketData>({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    return withServerSpan("http.fetch", { method: req.method, path: url.pathname }, async span => {
      try {
        if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
          // Gate cross-site WebSocket hijacking: only same-origin or allow-listed Origins upgrade.
          // req.url carries the scheme Bun terminated (http on 127.0.0.1 behind a TLS proxy), not
          // the browser's https — so behind Caddy the same-origin branch never matches and the
          // public origin must be supplied via ALLOWED_ORIGINS (see .env.example).
          const origin = req.headers.get("origin");
          if (!isOriginAllowed(origin, req.url, ALLOWED_ORIGINS)) {
            logger.warn("server", "rejected ws upgrade: origin not allowed", { origin });
            return new Response("Forbidden", { status: 403 });
          }
          // Per-IP connection cap: reserve a slot before upgrading; released on close. Behind
          // Caddy the real client IP is the first X-Forwarded-For entry, else the socket peer.
          const ip = clientIpFor(req.headers.get("x-forwarded-for"), server.requestIP(req)?.address);
          if (!ipConnections.tryAcquire(ip)) {
            logger.warn("server", "rejected ws upgrade: per-IP connection cap", { ip });
            return new Response("Too Many Requests", { status: 429 });
          }
          const data: SocketData = { clientId: crypto.randomUUID(), ip, rate: createMessageRateLimiter(MAX_WS_MSGS_PER_SEC) };
          if (server.upgrade(req, { data })) {
            return undefined as unknown as Response;
          }
          // Upgrade refused after we reserved a slot — release it so the IP isn't leaked.
          ipConnections.release(ip);
          return new Response("Upgrade failed", { status: 400 });
        }

        if (url.pathname === "/api/raids") {
          return Response.json(await getRaidCategories(), {
            headers: { "Cache-Control": raidCatalogCacheControl },
          });
        }

        // Liveness only — always 200 while the process is up. Capacity is never
        // encoded here so a full backend stays reachable for joins/reconnects.
        if (url.pathname === "/health") {
          return new Response("OK");
        }

        // Capacity snapshot for fleet tooling. Not exposed through Caddy by default.
        if (url.pathname === "/metrics/sessions") {
          return Response.json(capacitySnapshot(manager.sessions.size, MAX_SESSIONS), {
            headers: { "Cache-Control": "no-store" },
          });
        }

        // Serve bundled client
        const relPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const bundleFile = Bun.file(join(BUNDLE_DIR, relPath));
        if (await bundleFile.exists()) return withSecurityHeaders(new Response(bundleFile));

        // Serve static assets (effect icons, etc.) from /static/*. Validate the relative path to
        // avoid traversal; only simple file-path characters are allowed.
        if (url.pathname.startsWith("/static/")) {
          const rel = url.pathname.slice("/static/".length);
          if (/^[A-Za-z0-9_\-./]+$/.test(rel) && !rel.includes("..")) {
            const staticFile = Bun.file(join(STATIC_DIR, rel));
            if (await staticFile.exists()) {
              // Cacheable so assets warmed by preloadAssets() are reused from cache (no revalidation)
              // on a later raid change instead of downloading mid-pull.
              return withSecurityHeaders(new Response(staticFile, { headers: { "Cache-Control": "public, max-age=3600" } }));
            }
          }
          return new Response("Not found", { status: 404 });
        }

        return new Response("Not found", { status: 404 });
      } catch (err) {
        recordServerException(err, { area: "http.fetch", method: req.method, path: url.pathname }, span);
        logger.error("server", "request failed", { method: req.method, path: url.pathname, err });
        return new Response("Internal server error", { status: 500 });
      }
    });
  },

  websocket: {
    idleTimeout: 660,
    // Input frames are small and highly repetitive, so negotiated compression shrinks both the
    // 60 Hz relay stream and the one-shot full-input-log resync sent on late join / reconnect.
    perMessageDeflate: true,
    maxPayloadLength: MAX_WS_PAYLOAD_BYTES,
    open(ws) {
      clients.set(ws.data.clientId, ws);
      ws.send(JSON.stringify({ type: "joined", clientId: ws.data.clientId } satisfies ServerMessage));
      addServerTraceEvent("net", "WS connected", { clientId: ws.data.clientId });
      logger.info("net", "WS connected", { addr: ws.remoteAddress, clientId: ws.data.clientId });
    },
    async message(ws, msg) {
      // Per-connection flood guard: drop the message before any parse work once over the rate cap.
      if (!ws.data.rate.allow()) {
        metrics.wsRateLimitedTotal.inc();
        return;
      }
      await withServerSpan("ws.message", { clientId: ws.data.clientId }, async span => {
        metrics.wsMessagesTotal.inc();
        const text = typeof msg === "string" ? msg : wsTextDecoder.decode(msg);
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          metrics.wsInvalidTotal.inc();
          logger.warn("net", "invalid JSON", { clientId: ws.data.clientId });
          ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" } satisfies ServerMessage));
          return;
        }

        const parsed = ClientMessageSchema.safeParse(json);
        if (!parsed.success) {
          metrics.wsInvalidTotal.inc();
          logger.warn("net", "invalid message", { clientId: ws.data.clientId });
          ws.send(JSON.stringify({ type: "error", message: "Invalid message" } satisfies ServerMessage));
          return;
        }
        span.setAttribute("yas.message_type", parsed.data.type);
        if (parsed.data.type === "debugPosition") {
          logger.debug("hud", "player position", { clientId: ws.data.clientId, ...parsed.data });
          return;
        }

        addServerTraceEvent("net", "WS message", { clientId: ws.data.clientId, type: parsed.data.type });
        try {
          await manager.handle(ws.data.clientId, parsed.data);
        } catch (err) {
          recordServerException(err, { area: "ws.message", clientId: ws.data.clientId, type: parsed.data.type }, span);
          logger.error("net", "message handler failed", { clientId: ws.data.clientId, type: parsed.data.type, err });
          ws.send(JSON.stringify({ type: "error", message: "Server error" } satisfies ServerMessage));
        }
      });
    },
    close(ws) {
      ipConnections.release(ws.data.ip);
      clients.delete(ws.data.clientId);
      manager.disconnect(ws.data.clientId);
      addServerTraceEvent("net", "WS disconnected", { clientId: ws.data.clientId });
      logger.debug("net", "WS disconnected", { clientId: ws.data.clientId });
    },
  },
});

console.log("server", "dev server listening", { url: `http://localhost:${server.port}` });
