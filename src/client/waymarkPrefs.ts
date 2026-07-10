import { isWaymarkPresetId } from "@shared/waymarkPresets";

const WAYMARK_PRESET_KEY = "yas_waymark_preset";

type StoredPresets = Record<string, string>;

function readAll(): StoredPresets {
  try {
    const raw = localStorage.getItem(WAYMARK_PRESET_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: StoredPresets = {};
    for (const [raidId, presetId] of Object.entries(parsed)) {
      if (typeof presetId === "string" && isWaymarkPresetId(presetId)) out[raidId] = presetId;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: StoredPresets): void {
  try {
    localStorage.setItem(WAYMARK_PRESET_KEY, JSON.stringify(all));
  } catch {
    // localStorage unavailable (e.g. private browsing) - nothing to persist.
  }
}

export function loadWaymarkPreset(raidId: string): string | null {
  return readAll()[raidId] ?? null;
}

export function saveWaymarkPreset(raidId: string, presetId: string): void {
  const all = readAll();
  all[raidId] = presetId;
  writeAll(all);
}

export function clearWaymarkPreset(raidId: string): void {
  const all = readAll();
  delete all[raidId];
  writeAll(all);
}
