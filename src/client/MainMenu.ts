interface RaidEntry { id: string; name: string; }

const RAID_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_RAIDS = 50;
const MAX_RAID_NAME_LENGTH = 60;

function normalizeRaidEntry(value: unknown): RaidEntry | null {
  if (!value || typeof value !== "object") return null;

  const entry = value as { id?: unknown; name?: unknown };
  if (typeof entry.id !== "string" || !RAID_ID_RE.test(entry.id)) return null;
  if (typeof entry.name !== "string") return null;

  const name = entry.name.trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > MAX_RAID_NAME_LENGTH) return null;

  return { id: entry.id, name };
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tagName);
  if (className) el.className = className;
  if (textContent !== undefined) el.textContent = textContent;
  return el;
}

export async function showMainMenu(): Promise<{ raidId: string; sessionId: string }> {
  const sessionId = crypto.randomUUID();

  const res = await fetch("/api/raids");
  if (!res.ok) throw new Error(`Failed to load raid list: ${res.status}`);
  const json: unknown = await res.json();
  if (!Array.isArray(json)) throw new Error("Invalid raid list");
  const raids = json
    .map(normalizeRaidEntry)
    .filter((entry): entry is RaidEntry => entry !== null)
    .slice(0, MAX_RAIDS);
  if (raids.length === 0) throw new Error("No raids found");

  const settingsBtn = document.getElementById("settings-btn");
  if (settingsBtn) settingsBtn.style.display = "none";

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "yas-menu";

    const panel = createElement("div", "yas-menu-panel");
    panel.append(
      createElement("div", "yas-menu-title", "YET ANOTHER SIM"),
      createElement("div", "yas-menu-subtitle", "SELECT RAID STRATEGY"),
    );

    const raidsEl = createElement("div", "yas-menu-raids");
    raids.forEach((raid, index) => {
      const label = createElement("label", "yas-menu-raid-option");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "raid";
      input.value = raid.id;
      input.checked = index === 0;

      label.append(input, createElement("span", undefined, raid.name));
      raidsEl.appendChild(label);
    });

    const sessionEl = createElement("div", "yas-menu-session");
    sessionEl.append(
      createElement("span", "yas-menu-session-label", "SESSION"),
      createElement("span", "yas-menu-session-id", sessionId),
    );

    const startBtn = createElement("button", "yas-menu-start", "START");
    startBtn.id = "yas-menu-start-btn";

    panel.append(raidsEl, sessionEl, startBtn);
    overlay.appendChild(panel);

    document.body.appendChild(overlay);

    startBtn.addEventListener("click", () => {
      const checked = overlay.querySelector<HTMLInputElement>("input[name=raid]:checked");
      const raidId = checked?.value ?? raids[0].id;
      overlay.remove();
      if (settingsBtn) settingsBtn.style.display = "";
      resolve({ raidId, sessionId });
    });
  });
}
