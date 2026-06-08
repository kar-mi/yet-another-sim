import { join } from "path";
import {
  ClientMessageSchema,
  MAX_RAIDS,
  RAID_ID_REGEX,
  RAID_SEGMENT_REGEX,
  normalizeRaidName,
  type RaidCategory,
  type RaidEntry,
  type ServerMessage,
} from "../src/shared/protocol";
import { SessionManager } from "./session";
import { logger, createSessionLog, debugEnabled } from "./logger";

const ROOT = join(import.meta.dir, "..");
const BUNDLE_DIR = join(ROOT, ".bundle");
const RAIDS_DIR = join(ROOT, "raids");
const STATIC_DIR = join(ROOT, "static");
const RAID_FILE_RE = new RegExp(`^/raids/(${RAID_ID_REGEX.source.slice(1, -1)})\\.json$`);
const PORT = Number(Bun.env.PORT || 3000);

interface SocketData {
  clientId: string;
}

function raidSegmentFromFile(file: string): string | null {
  if (!file.endsWith(".json")) return null;

  const segment = file.slice(0, -".json".length);
  return RAID_SEGMENT_REGEX.test(segment) ? segment : null;
}

function raidFileFromPath(pathname: string): string | null {
  const match = pathname.match(RAID_FILE_RE);
  return match ? `${match[1]}.json` : null;
}

async function loadCategoryRaids(categoryId: string, remaining: number): Promise<RaidEntry[]> {
  const glob = new Bun.Glob("*.json");
  const dir = join(RAIDS_DIR, categoryId);
  const files = (await Array.fromAsync(glob.scan(dir))).sort();
  const raids: RaidEntry[] = [];

  for (const file of files) {
    if (file === "raid_info.json" || file.endsWith("-bots.json")) continue;
    if (raids.length >= remaining) break;

    const segment = raidSegmentFromFile(file);
    if (!segment) {
      logger.warn("raid", "skipping raid with invalid filename", { category: categoryId, file });
      continue;
    }

    let json: { name?: unknown };
    try {
      json = await Bun.file(join(dir, file)).json() as { name?: unknown };
    } catch {
      logger.warn("raid", "skipping raid with invalid JSON", { category: categoryId, file });
      continue;
    }

    const name = normalizeRaidName(json.name);
    if (!name) {
      logger.warn("raid", "skipping raid with invalid name", { category: categoryId, file });
      continue;
    }

    raids.push({ id: `${categoryId}/${segment}`, name });
  }

  return raids;
}

async function loadRaidCategories(): Promise<RaidCategory[]> {
  const glob = new Bun.Glob("*/raid_info.json");
  const infoFiles = (await Array.fromAsync(glob.scan(RAIDS_DIR))).sort();
  const categories: RaidCategory[] = [];
  let total = 0;

  for (const rawInfoFile of infoFiles) {
    if (total >= MAX_RAIDS) break;

    const infoFile = rawInfoFile.replaceAll("\\", "/");
    const categoryId = infoFile.slice(0, infoFile.indexOf("/"));
    if (!RAID_SEGMENT_REGEX.test(categoryId)) {
      logger.warn("raid", "skipping category with invalid folder name", { category: categoryId });
      continue;
    }

    let info: { name?: unknown; description?: unknown };
    try {
      info = await Bun.file(join(RAIDS_DIR, infoFile)).json() as { name?: unknown; description?: unknown };
    } catch {
      logger.warn("raid", "skipping category with invalid raid_info.json", { category: categoryId });
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
  sourcemap: "inline",
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
  send(clientId: string, message: ServerMessage) {
    const ws = clients.get(clientId);
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  },
  createSessionLog,
});
setInterval(() => manager.pruneExpired(), 60_000);

const server = Bun.serve<SocketData>({
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);

    if (server.upgrade(req, { data: { clientId: crypto.randomUUID() } })) {
      return undefined as unknown as Response;
    }

    if (url.pathname === "/api/raids") {
      return Response.json(await loadRaidCategories());
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

    const raidFileName = raidFileFromPath(url.pathname);
    if (raidFileName) {
      const raidFile = Bun.file(join(RAIDS_DIR, raidFileName));
      if (await raidFile.exists()) return new Response(raidFile);
    }

    return new Response("Not found", { status: 404 });
  },

  websocket: {
    idleTimeout: 660,
    open(ws) {
      clients.set(ws.data.clientId, ws);
      ws.send(JSON.stringify({ type: "joined", clientId: ws.data.clientId } satisfies ServerMessage));
      logger.info("net", "WS connected", { addr: ws.remoteAddress, clientId: ws.data.clientId });
    },
    async message(ws, msg) {
      try {
        const text = typeof msg === "string" ? msg : new TextDecoder().decode(msg);
        const parsed = ClientMessageSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          logger.warn("net", "invalid message", { clientId: ws.data.clientId });
          ws.send(JSON.stringify({ type: "error", message: "Invalid message" } satisfies ServerMessage));
          return;
        }
        if (parsed.data.type === "debugPosition") {
          logger.debug("hud", "player position", { clientId: ws.data.clientId, ...parsed.data });
          return;
        }

        await manager.handle(ws.data.clientId, parsed.data);
      } catch {
        logger.warn("net", "invalid JSON", { clientId: ws.data.clientId });
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" } satisfies ServerMessage));
      }
    },
    close(ws) {
      clients.delete(ws.data.clientId);
      manager.disconnect(ws.data.clientId);
      logger.debug("net", "WS disconnected", { clientId: ws.data.clientId });
    },
  },
});

console.log("server", "dev server listening", { url: `http://localhost:${server.port}` });
