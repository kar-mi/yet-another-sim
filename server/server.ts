import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const BUNDLE_DIR = join(ROOT, ".bundle");
const RAIDS_DIR = join(ROOT, "raids");
const RAID_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_RAIDS = 50;
const MAX_RAID_NAME_LENGTH = 60;

interface RaidEntry {
  id: string;
  name: string;
}

function raidIdFromFile(file: string): string | null {
  if (!file.endsWith(".json")) return null;

  const id = file.slice(0, -".json".length);
  return RAID_ID_RE.test(id) ? id : null;
}

function raidFileFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/raids\/([a-z0-9][a-z0-9-]{0,63})\.json$/);
  return match ? `${match[1]}.json` : null;
}

function normalizeRaidName(name: unknown): string | null {
  if (typeof name !== "string") return null;

  const normalized = name.trim().replace(/\s+/g, " ");
  if (normalized.length === 0 || normalized.length > MAX_RAID_NAME_LENGTH) return null;
  return normalized;
}

async function loadRaidEntries(): Promise<RaidEntry[]> {
  const glob = new Bun.Glob("*.json");
  const files = (await Array.fromAsync(glob.scan(RAIDS_DIR))).sort();
  const raids: RaidEntry[] = [];

  for (const file of files) {
    if (raids.length >= MAX_RAIDS) break;

    const id = raidIdFromFile(file);
    if (!id) {
      console.warn(`Skipping raid with invalid filename: ${file}`);
      continue;
    }

    let json: { name?: unknown };
    try {
      json = await Bun.file(join(RAIDS_DIR, file)).json() as { name?: unknown };
    } catch {
      console.warn(`Skipping raid with invalid JSON: ${file}`);
      continue;
    }

    const name = normalizeRaidName(json.name);
    if (!name) {
      console.warn(`Skipping raid with invalid name: ${file}`);
      continue;
    }

    raids.push({ id, name });
  }

  return raids;
}

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
    open(ws) { console.log("WS connected:", ws.remoteAddress); },
    // stub: echo back — will be replaced with authoritative sim broadcast
    message(ws, msg) { ws.send(msg); },
    close(ws) { console.log("WS disconnected"); },
  },
});

console.log(`Dev server → http://localhost:${server.port}`);
