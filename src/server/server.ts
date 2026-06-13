import { addServerTraceEvent, recordServerException, withServerSpan } from "./otel";
import { parseRaidFile } from "./raidFileReader";
import { join } from "path";
import {
  ClientMessageSchema,
  MAX_RAIDS,
  RAID_SEGMENT_REGEX,
  normalizeRaidName,
  type RaidCategory,
  type RaidEntry,
  type ServerMessage,
} from "@shared/protocol";
import { SessionManager, capacitySnapshot } from "./session";
import { logger, createSessionLog, debugEnabled } from "./logger";
import { metrics } from "./metrics";
import { startMetricsServer } from "./metricsServer";

const ROOT = join(import.meta.dir, "..", "..");
const BUNDLE_DIR = join(ROOT, ".bundle");
const RAIDS_DIR = join(ROOT, "raids");
const STATIC_DIR = join(ROOT, "static");
const PORT = Number(Bun.env.PORT || 3000);

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

interface SocketData {
  clientId: string;
}

function raidSegmentFromFile(file: string): string | null {
  const ext = file.endsWith(".yaml") ? ".yaml" : file.endsWith(".yml") ? ".yml" : null;
  if (!ext) return null;
  const segment = file.slice(0, -ext.length);
  return RAID_SEGMENT_REGEX.test(segment) ? segment : null;
}

async function loadCategoryRaids(categoryId: string, remaining: number): Promise<RaidEntry[]> {
  const dir = join(RAIDS_DIR, categoryId);
  const EXTS = [".yaml", ".yml"] as const;

  // Collect files across all extensions; first extension in priority order wins per segment.
  const segmentMap = new Map<string, string>(); // segment → filename
  for (const ext of EXTS) {
    for (const file of await Array.fromAsync(new Bun.Glob(`*${ext}`).scan(dir))) {
      const segment = file.slice(0, -ext.length);
      if (!segmentMap.has(segment)) segmentMap.set(segment, file);
    }
  }

  const files = [...segmentMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, file]) => file);

  const raids: RaidEntry[] = [];

  for (const file of files) {
    const base = raidSegmentFromFile(file);
    if (!base || base === "raid_info" || base.endsWith("-bots")) continue;
    if (raids.length >= remaining) break;

    let obj: { name?: unknown };
    try {
      obj = await parseRaidFile(join(dir, file)) as { name?: unknown };
    } catch {
      logger.warn("raid", "skipping raid with invalid file", { category: categoryId, file });
      continue;
    }

    const name = normalizeRaidName(obj.name);
    if (!name) {
      logger.warn("raid", "skipping raid with invalid name", { category: categoryId, file });
      continue;
    }

    raids.push({ id: `${categoryId}/${base}`, name });
  }

  return raids;
}

async function loadRaidCategories(): Promise<RaidCategory[]> {
  const EXTS = [".yaml", ".yml"] as const;

  // Collect raid_info files; first extension wins per category.
  const categoryMap = new Map<string, string>(); // categoryId → infoFile path
  for (const ext of EXTS) {
    for (const raw of await Array.fromAsync(new Bun.Glob(`*/raid_info${ext}`).scan(RAIDS_DIR))) {
      const infoFile = raw.replaceAll("\\", "/");
      const categoryId = infoFile.slice(0, infoFile.indexOf("/"));
      if (!categoryMap.has(categoryId)) categoryMap.set(categoryId, infoFile);
    }
  }

  const infoEntries = [...categoryMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  const categories: RaidCategory[] = [];
  let total = 0;

  for (const [categoryId, infoFile] of infoEntries) {
    if (total >= MAX_RAIDS) break;

    if (!RAID_SEGMENT_REGEX.test(categoryId)) {
      logger.warn("raid", "skipping category with invalid folder name", { category: categoryId });
      continue;
    }

    let info: { name?: unknown; description?: unknown };
    try {
      info = await parseRaidFile(join(RAIDS_DIR, infoFile)) as { name?: unknown; description?: unknown };
    } catch {
      logger.warn("raid", "skipping category with invalid raid_info", { category: categoryId });
      continue;
    }

    const name = normalizeRaidName(info.name);
    if (!name) {
      logger.warn("raid", "skipping category with invalid name", { category: categoryId });
      continue;
    }

    const description = typeof info.description === "string" ? info.description : "";
    const raids = await loadCategoryRaids(categoryId, MAX_RAIDS - total);
    total += raids.length;
    categories.push({ id: categoryId, name, description, raids });
  }

  return categories;
}

logger.info("build", "building client bundle");
const buildResult = await Bun.build({
  entrypoints: [join(ROOT, "index.html")],
  outdir: BUNDLE_DIR,
  target: "browser",
  sourcemap: debugEnabled ? "inline" : "none",
  env: "disable",
  define: {
    __YAS_DEBUG__: JSON.stringify(debugEnabled),
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
    if (ws?.readyState === WebSocket.OPEN) ws.send(typeof message === "string" ? message : JSON.stringify(message));
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
        if (server.upgrade(req, { data: { clientId: crypto.randomUUID() } })) {
          return undefined as unknown as Response;
        }

        if (url.pathname === "/api/raids") {
          return Response.json(await loadRaidCategories());
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
            if (await staticFile.exists()) return new Response(staticFile);
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
        const text = typeof msg === "string" ? msg : new TextDecoder().decode(msg);
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
