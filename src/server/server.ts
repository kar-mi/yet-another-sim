import { addServerTraceEvent, recordServerException, withServerSpan } from "./otel";
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

// Client->server messages (intents, joins, claims) are all tiny, so cap accepted WS payloads well
// below Bun's ~16 MB default to cheaply reject abusive oversized frames. This bounds ingress only;
// the large outbound resync (full input log) is not governed by it.
const MAX_WS_PAYLOAD_BYTES = 1 << 20; // 1 MiB

// Only large one-shot payloads (the full-input-log resync on late join / reconnect) are worth
// compressing. The tiny 60 Hz frame stream is pure compress/decompress latency under
// perMessageDeflate, so anything below this is sent uncompressed (Bun's per-send compress flag).
const WS_COMPRESS_THRESHOLD = 8192;

interface SocketData {
  clientId: string;
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
  },
});

if (!buildResult.success) {
  for (const log of buildResult.logs) logger.error("build", String(log));
  process.exit(1);
}
logger.info("build", "bundle ready");

const clients = new Map<string, Bun.ServerWebSocket<SocketData>>();
const manager = new SessionManager({
  raidsDir: RAIDS_DIR,
  send(clientId: string, message: ServerMessage | string) {
    const ws = clients.get(clientId);
    if (ws?.readyState !== WebSocket.OPEN) return;
    const payload = typeof message === "string" ? message : JSON.stringify(message);
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
          if (server.upgrade(req, { data: { clientId: crypto.randomUUID() } })) {
            return undefined as unknown as Response;
          }
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
        if (await bundleFile.exists()) return new Response(bundleFile);

        // Serve static assets (effect icons, etc.) from /static/*. Validate the relative path to
        // avoid traversal; only simple file-path characters are allowed.
        if (url.pathname.startsWith("/static/")) {
          const rel = url.pathname.slice("/static/".length);
          if (/^[A-Za-z0-9_\-./]+$/.test(rel) && !rel.includes("..")) {
            const staticFile = Bun.file(join(STATIC_DIR, rel));
            if (await staticFile.exists()) {
              // Cacheable so assets warmed by preloadAssets() are reused from cache (no revalidation)
              // on a later raid change instead of downloading mid-pull.
              return new Response(staticFile, { headers: { "Cache-Control": "public, max-age=3600" } });
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
      clients.delete(ws.data.clientId);
      manager.disconnect(ws.data.clientId);
      addServerTraceEvent("net", "WS disconnected", { clientId: ws.data.clientId });
      logger.debug("net", "WS disconnected", { clientId: ws.data.clientId });
    },
  },
});

console.log("server", "dev server listening", { url: `http://localhost:${server.port}` });
