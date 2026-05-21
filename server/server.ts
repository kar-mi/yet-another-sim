import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const BUNDLE_DIR = join(ROOT, ".bundle");

console.log("Building client bundle...");
const buildResult = await Bun.build({
  entrypoints: [join(ROOT, "index.html")],
  outdir: BUNDLE_DIR,
  target: "browser",
  sourcemap: "inline",
});

if (!buildResult.success) {
  for (const log of buildResult.logs) console.error(log);
  process.exit(1);
}
console.log("Bundle ready.");

const server = Bun.serve({
  port: 3000,

  async fetch(req) {
    const url = new URL(req.url);

    if (server.upgrade(req)) return undefined as unknown as Response;

    // Serve bundled client
    const relPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const bundleFile = Bun.file(join(BUNDLE_DIR, relPath));
    if (await bundleFile.exists()) return new Response(bundleFile);

    // Serve static project assets (raids/*.json, etc.)
    const staticFile = Bun.file(join(ROOT, relPath));
    if (await staticFile.exists()) return new Response(staticFile);

    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws) { console.log("WS connected:", ws.remoteAddress); },
    // stub: echo back — will be replaced with authoritative sim broadcast
    message(ws, msg) { ws.send(msg); },
    close(ws) { console.log("WS disconnected"); },
  },
});

console.log(`Dev server → http://localhost:${server.port}`);
