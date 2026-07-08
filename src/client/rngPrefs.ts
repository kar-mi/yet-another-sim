const RNG_CONSTRAINTS_KEY = "yas_rng_constraints";

type StoredConstraints = Record<string, Record<string, number>>;

function readAll(): StoredConstraints {
  try {
    const raw = localStorage.getItem(RNG_CONSTRAINTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: StoredConstraints = {};
    for (const [raidId, constraints] of Object.entries(parsed)) {
      if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) continue;
      out[raidId] = {};
      for (const [key, value] of Object.entries(constraints)) {
        if (Number.isInteger(value) && value >= 0) out[raidId][key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: StoredConstraints): void {
  try {
    localStorage.setItem(RNG_CONSTRAINTS_KEY, JSON.stringify(all));
  } catch {
    // localStorage unavailable (e.g. private browsing) - nothing to persist.
  }
}

export function loadRngConstraints(raidId: string): Record<string, number> {
  return { ...readAll()[raidId] };
}

export function saveRngConstraints(raidId: string, constraints: Record<string, number>): void {
  const all = readAll();
  all[raidId] = { ...constraints };
  writeAll(all);
}

export function clearRngConstraints(raidId: string): void {
  const all = readAll();
  delete all[raidId];
  writeAll(all);
}
