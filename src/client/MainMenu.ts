import { SessionIdSchema, type LobbySlot, type LobbyStatus } from "../shared/protocol";
import type { World } from "../shared/types";
import type { NetClient } from "./net";

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

export async function showMainMenu(net: NetClient): Promise<{ world: World; yourPlayerId: string; sessionId: string }> {
  let sessionId: string = crypto.randomUUID();

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
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const showError = (message: string) => {
      let errorEl = panel.querySelector<HTMLDivElement>(".yas-menu-error");
      if (!errorEl) {
        errorEl = createElement("div", "yas-menu-error");
        panel.appendChild(errorEl);
      }
      errorEl.textContent = message;
    };

    const cleanup = () => {
      for (const dispose of disposers) dispose();
      overlay.remove();
      if (settingsBtn) settingsBtn.style.display = "";
    };

    const renderHeader = (subtitle: string) => {
      panel.replaceChildren(
        createElement("div", "yas-menu-title", "YET ANOTHER SIM"),
        createElement("div", "yas-menu-subtitle", subtitle),
      );
    };

    let pendingJoinBtn: HTMLButtonElement | null = null;

    const renderRaidSelect = () => {
      renderHeader("SELECT RAID STRATEGY");

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

      const sessionEl = createElement("label", "yas-menu-session");
      const sessionInput = document.createElement("input");
      sessionInput.className = "yas-menu-session-input";
      sessionInput.value = sessionId;
      sessionInput.maxLength = 64;
      sessionEl.append(
        createElement("span", "yas-menu-session-label", "SESSION"),
        sessionInput,
      );

      const joinBtn = createElement("button", "yas-menu-start", "JOIN");
      joinBtn.id = "yas-menu-start-btn";
      joinBtn.addEventListener("click", () => {
        const nextSessionId = sessionInput.value.trim().toLowerCase();
        const sessionResult = SessionIdSchema.safeParse(nextSessionId);
        if (!sessionResult.success) {
          showError("Session ID must use lowercase letters, numbers, or hyphens");
          return;
        }

        const checked = overlay.querySelector<HTMLInputElement>("input[name=raid]:checked");
        sessionId = sessionResult.data;
        joinBtn.disabled = true;
        pendingJoinBtn = joinBtn;
        net.send({ type: "join", raidId: checked?.value ?? raids[0].id, sessionId });
        renderHeader("WAITING FOR LOBBY");
      });

      panel.append(raidsEl, sessionEl, joinBtn);
    };

    const renderSlot = (slot: LobbySlot, claimedByMe: boolean): HTMLElement => {
      const row = createElement("div", "yas-lobby-slot");
      const meta = createElement("div", "yas-lobby-slot-meta");
      meta.append(
        createElement("span", "yas-lobby-slot-id", slot.playerId),
        createElement("span", "yas-lobby-slot-role", slot.role.toUpperCase()),
      );

      const status = slot.claimedByYou ? "YOU" : slot.claimed ? "CLAIMED" : "BOT";
      const action = createElement("button", "yas-lobby-slot-action", slot.claimedByYou ? "RELEASE" : "CLAIM");
      action.disabled = (slot.claimed && !slot.claimedByYou) || (!slot.claimedByYou && claimedByMe);
      action.addEventListener("click", () => {
        net.send(slot.claimedByYou
          ? { type: "releaseSlot", playerId: slot.playerId }
          : { type: "claimSlot", playerId: slot.playerId });
      });

      row.append(meta, createElement("div", "yas-lobby-slot-status", status), action);
      return row;
    };

    const renderLobby = (message: {
      hostClientId: string;
      slots: LobbySlot[];
      raidName: string;
      status: LobbyStatus;
    }) => {
      pendingJoinBtn = null;
      const subtitle = message.status === "lobby"
        ? `${message.raidName.toUpperCase()} — CLAIM PARTY SLOT`
        : message.status === "running"
          ? `${message.raidName.toUpperCase()} — IN PROGRESS, CLAIM TO JOIN`
          : `${message.raidName.toUpperCase()} — FINISHED`;
      renderHeader(subtitle);

      const claimedByMe = message.slots.some(slot => slot.claimedByYou);
      const slotList = createElement("div", "yas-lobby-slots");
      for (const slot of message.slots) slotList.appendChild(renderSlot(slot, claimedByMe));

      const isHost = net.clientId === message.hostClientId;
      const canStart = message.status === "lobby" && message.slots.some(slot => slot.claimed);
      const startLabel = message.status !== "lobby"
        ? message.status === "running" ? "IN PROGRESS" : "FINISHED"
        : isHost ? "START" : "WAIT HOST";
      const startBtn = createElement("button", "yas-menu-start", startLabel);
      startBtn.disabled = !isHost || !canStart;
      startBtn.addEventListener("click", () => net.send({ type: "start" }));

      const sessionEl = createElement("div", "yas-menu-session");
      sessionEl.append(
        createElement("span", "yas-menu-session-label", "SESSION"),
        createElement("span", "yas-menu-session-id", sessionId),
      );

      panel.append(slotList, sessionEl, startBtn);
    };

    const disposers = [
      net.on("lobby", renderLobby),
      net.on("started", message => {
        cleanup();
        resolve({ world: message.world, yourPlayerId: message.yourPlayerId, sessionId });
      }),
      net.on("error", message => {
        if (pendingJoinBtn) {
          pendingJoinBtn = null;
          renderRaidSelect();
        }
        showError(message.message);
      }),
    ];

    renderRaidSelect();
  });
}
