import { join } from "path";
import { MAX_RAIDS, RAID_SEGMENT_REGEX, normalizeRaidName, type RaidCategory, type RaidEntry } from "@shared/protocol";
import { isDevelopment, logger } from "./logger";
import { parseRaidFile } from "./raidFileReader";

const ROOT = join(import.meta.dir, "..", "..");
export const RAIDS_DIR = join(ROOT, "raids");
const RAID_CATALOG_TTL_MS = 60_000;

function raidSegmentFromFile(file: string): string | null {
  const ext = file.endsWith(".yaml") ? ".yaml" : file.endsWith(".yml") ? ".yml" : null;
  if (!ext) return null;
  const segment = file.slice(0, -ext.length);
  return RAID_SEGMENT_REGEX.test(segment) ? segment : null;
}

async function loadCategoryRaids(categoryId: string, remaining: number): Promise<RaidEntry[]> {
  const dir = join(RAIDS_DIR, categoryId);
  const extensions = [".yaml", ".yml"] as const;
  const segmentMap = new Map<string, string>();
  for (const ext of extensions) {
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
  const extensions = [".yaml", ".yml"] as const;
  const categoryMap = new Map<string, string>();
  for (const ext of extensions) {
    for (const raw of await Array.fromAsync(new Bun.Glob(`*/raid_info${ext}`).scan(RAIDS_DIR))) {
      const infoFile = raw.replaceAll("\\", "/");
      const categoryId = infoFile.slice(0, infoFile.indexOf("/"));
      if (!categoryMap.has(categoryId)) categoryMap.set(categoryId, infoFile);
    }
  }

  const categories: RaidCategory[] = [];
  let total = 0;
  for (const [categoryId, infoFile] of [...categoryMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (total >= MAX_RAIDS) break;
    if (!RAID_SEGMENT_REGEX.test(categoryId)) {
      logger.warn("raid", "skipping category with invalid folder name", { category: categoryId });
      continue;
    }
    let info: { name?: unknown; description?: unknown };
    try {
      info = await parseRaidFile(join(RAIDS_DIR, infoFile)) as typeof info;
    } catch {
      logger.warn("raid", "skipping category with invalid raid_info", { category: categoryId });
      continue;
    }
    const name = normalizeRaidName(info.name);
    if (!name) {
      logger.warn("raid", "skipping category with invalid name", { category: categoryId });
      continue;
    }
    const raids = await loadCategoryRaids(categoryId, MAX_RAIDS - total);
    total += raids.length;
    categories.push({ id: categoryId, name, description: typeof info.description === "string" ? info.description : "", raids });
  }
  return categories;
}

export function createRaidCatalogAccessor<T>(
  load: () => Promise<T>,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<T> {
  let cache: { at: number; data: T } | null = null;
  let inflight: Promise<T> | null = null;
  return function get(): Promise<T> {
    const time = now();
    if (cache && time - cache.at < ttlMs) return Promise.resolve(cache.data);
    if (inflight) return inflight;
    inflight = load()
      .then(data => {
        cache = { at: now(), data };
        return data;
      })
      .finally(() => { inflight = null; });
    return inflight;
  };
}

export const raidCatalogCacheControl = isDevelopment ? "no-store" : "public, max-age=60";
export const getRaidCategories = createRaidCatalogAccessor(
  loadRaidCategories,
  isDevelopment ? 0 : RAID_CATALOG_TTL_MS,
);
