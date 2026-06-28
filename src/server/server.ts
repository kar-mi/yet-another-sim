import { join } from "path";
import { Server, type ServerOptions } from "colyseus";
import { BunWebSockets } from "@colyseus/bun-websockets";
import { RedisDriver } from "@colyseus/redis-driver";
import { RedisPresence } from "@colyseus/redis-presence";
import { RelayServerRoom, MAX_SESSIONS, relayClientsConnected, relayRoomsActive } from "./relayServerRoom";
import { capacitySnapshot } from "./relayRoom";
import { logger } from "./logger";
import { startMetricsServer } from "./metricsServer";
import { getRaidCategories, raidCatalogCacheControl } from "./raidCatalog";

const ROOT = join(import.meta.dir, "..", "..");
const BUNDLE_DIR = join(ROOT, ".bundle");
const STATIC_DIR = join(ROOT, "static");
const PORT = Number(Bun.env.PORT || 3000);

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

function cacheControlForBundlePath(path: string): string {
  return path === "index.html" ? "no-cache" : "public, max-age=31536000, immutable";
}

function publicAddressForPort(port: number): string {
  const host = Bun.env.PUBLIC_HOST || `localhost:${port}`;
  return `${host.replace(/\/+$/, "")}/${port}`;
}

// @colyseus/bun-websockets 0.17 ships bun-serve-express 2.x, whose res.send() concatenates Buffer
// chunks with Buffer.concat (binary-safe), so we serve files as a Buffer with an explicit
// Content-Type. (0.16 stringified the body via `_writes.join("")`, corrupting bytes > 0x7F, which
// forced a manual workaround — no longer needed.)
async function sendFile(res: any, file: Bun.BunFile, cacheControl: string): Promise<void> {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  res.setHeader("Cache-Control", cacheControl);
  if (file.type) res.setHeader("Content-Type", file.type);
  res.status(200).send(Buffer.from(await file.arrayBuffer()));
}

async function sendBundlePath(res: any, relPath: string): Promise<boolean> {
  const file = Bun.file(join(BUNDLE_DIR, relPath));
  if (!(await file.exists())) return false;
  await sendFile(res, file, cacheControlForBundlePath(relPath));
  return true;
}

if (Bun.env.BUILD_ON_START === "1") {
  logger.info("build", "building client bundle");
  const buildResult = await Bun.build({
    entrypoints: [join(ROOT, "index.html")],
    outdir: BUNDLE_DIR,
    sourcemap: "none",
    env: "disable",
    minify: !Bun.env.YAS_DEBUG_BUNDLE,
    ignoreDCEAnnotations: true,
    define: {
      __YAS_STATIC__: "false",
      __YAS_DEBUG__: Bun.env.YAS_DEBUG_CLIENT === "1" ? "true" : "false",
    },
  });

  if (!buildResult.success) {
    for (const log of buildResult.logs) logger.error("build", log.message);
    process.exit(1);
  }
} else if (!(await Bun.file(join(BUNDLE_DIR, "index.html")).exists())) {
  logger.error("build", "missing .bundle/index.html; run `bun run build` or set BUILD_ON_START=1");
  process.exit(1);
}

const transport = new BunWebSockets({ maxPayloadLength: 1 << 20 });
// Register HTTP routes via the `express` option (not `transport.getExpressApp()` after construction):
// in 0.17 this both (a) tells Colyseus to detect our root route so it skips its default `GET /`
// version-string handler, and (b) registers the routes before the matchmaking router is bound, so
// the transport falls through to express for every non-matchmaking path.
const serverOptions: ServerOptions = {
  transport,
  express: (app: any) => {
    app.get("/health", (_req: any, res: any) => res.status(200).send("OK"));
    app.get("/metrics/sessions", (_req: any, res: any) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(capacitySnapshot(relayRoomsActive(), MAX_SESSIONS));
    });
    app.get("/api/raids", async (_req: any, res: any) => {
      res.setHeader("Cache-Control", raidCatalogCacheControl);
      res.json(await getRaidCategories());
    });
    app.get("/static/*splat", async (req: any, res: any) => {
      const rel = String(req.path ?? "").slice("/static/".length);
      if (!/^[A-Za-z0-9_\-./]+$/.test(rel) || rel.includes("..")) return res.status(404).send("Not found");
      const file = Bun.file(join(STATIC_DIR, rel));
      if (!(await file.exists())) return res.status(404).send("Not found");
      await sendFile(res, file, "public, max-age=3600");
    });
    app.get("/{*splat}", async (req: any, res: any) => {
      const path = String(req.path ?? "/");
      const relPath = path === "/" ? "index.html" : path.slice(1);
      if (await sendBundlePath(res, relPath)) return;
      if (await sendBundlePath(res, "index.html")) return;
      res.status(404).send("Not found");
    });
  },
};
if (Bun.env.REDIS_URL) {
  serverOptions.presence = new RedisPresence(Bun.env.REDIS_URL) as unknown as ServerOptions["presence"];
  serverOptions.driver = new RedisDriver(Bun.env.REDIS_URL);
  serverOptions.publicAddress = publicAddressForPort(PORT);
}
const gameServer = new Server(serverOptions);
gameServer.define("relay", RelayServerRoom).filterBy(["sessionId"]);

startMetricsServer({
  sessionsActive: relayRoomsActive,
  clientsConnected: relayClientsConnected,
  sessionsCapacity: MAX_SESSIONS,
});

await gameServer.listen(PORT);
console.log("server", "dev server listening", { url: `http://localhost:${PORT}` });
