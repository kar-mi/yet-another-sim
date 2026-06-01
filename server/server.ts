import { join } from "path";
import {
  ClientMessageSchema,
  MAX_RAIDS,
  RAID_ID_REGEX,
  normalizeRaidName,
  type RaidEntry,
  type ServerMessage,
} from "../src/shared/protocol";
import { SessionManager } from "./session";
import { logger } from "./logger";

const ROOT = join(import.meta.dir, "..");
const BUNDLE_DIR = join(ROOT, ".bundle");
const RAIDS_DIR = join(ROOT, "raids");
const RAID_FILE_RE = new RegExp(`^/raids/(${RAID_ID_REGEX.source.slice(1, -1)})\\.json$`);

interface SocketData {
  clientId: string;
}

function raidIdFromFile(file: string): string | null {
  if (!file.endsWith(".json")) return null;

  const id = file.slice(0, -".json".length);
  return RAID_ID_REGEX.test(id) ? id : null;
}

function raidFileFromPath(pathname: string): string | null {
  const match = pathname.match(RAID_FILE_RE);
  return match ? `${match[1]}.json` : null;
}

async function loadRaidEntries(): Promise<RaidEntry[]> {
  const glob = new Bun.Glob("*.json");
  const files = (await Array.fromAsync(glob.scan(RAIDS_DIR))).sort();
  const raids: RaidEntry[] = [];

  for (const file of files) {
    if (file.endsWith("-bots.json")) continue;
    if (raids.length >= MAX_RAIDS) break;

    const id = raidIdFromFile(file);
    if (!id) {
      logger.warn("raid", "skipping raid with invalid filename", { file });
      continue;
    }

    let json: { name?: unknown };
    try {
      json = await Bun.file(join(RAIDS_DIR, file)).json() as { name?: unknown };
    } catch {
      logger.warn("raid", "skipping raid with invalid JSON", { file });
      continue;
    }

    const name = normalizeRaidName(json.name);
    if (!name) {
      logger.warn("raid", "skipping raid with invalid name", { file });
      continue;
    }

    raids.push({ id, name });
  }

  return raids;
}

logger.info("build", "building client bundle");
const buildResult = await Bun.build({
  entrypoints: [join(ROOT, "index.html")],
  outdir: BUNDLE_DIR,
  target: "browser",
  sourcemap: "inline",
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
});
setInterval(() => manager.pruneExpired(), 60_000);

const server = Bun.serve<SocketData>({
  port: 3000,

  async fetch(req, server) {
    const url = new URL(req.url);

    if (server.upgrade(req, { data: { clientId: crypto.randomUUID() } })) {
      return undefined as unknown as Response;
    }

    if (url.pathname === "/api/raids") {
      return Response.json(await loadRaidEntries());
    }

    // Serve bundled client
    const relPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const bundleFile = Bun.file(join(BUNDLE_DIR, relPath));
    if (await bundleFile.exists()) return new Response(bundleFile);

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

logger.info("server", "dev server listening", { url: `http://localhost:${server.port}` });
