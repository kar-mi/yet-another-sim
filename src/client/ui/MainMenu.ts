import {
  EMPTY_RAID_ID,
  MAX_RAIDS,
  RAID_ID_REGEX,
  RAID_SEGMENT_REGEX,
  SessionIdSchema,
  normalizeRaidName,
  type LobbySlot,
  type LobbyStatus,
  type PlaybackState,
  type RaidCategory,
  type RaidEntry,
  type ServerMessage,
} from "@shared/protocol";
import type { World } from "@shared/types";
import type { NetClient } from "../net";
import { createElement } from "./dom";

const LOBBY_SLOT_ORDER = ["mt", "ot", "h1", "h2", "m1", "m2", "r1", "r2"] as const;

type LobbyMessage = Extract<ServerMessage, { type: "lobby" }>;

function normalizeRaidEntry(value: unknown): RaidEntry | null {
  if (!value || typeof value !== "object") return null;

  const entry = value as { id?: unknown; name?: unknown };
  if (typeof entry.id !== "string" || !RAID_ID_REGEX.test(entry.id)) return null;

  const name = normalizeRaidName(entry.name);
  if (!name) return null;

  return { id: entry.id, name };
}


function normalizeCategory(value: unknown): RaidCategory | null {
  if (!value || typeof value !== "object") return null;

  const cat = value as { id?: unknown; name?: unknown; description?: unknown; raids?: unknown };
  if (typeof cat.id !== "string" || !RAID_SEGMENT_REGEX.test(cat.id)) return null;

  const name = normalizeRaidName(cat.name);
  if (!name) return null;

  const description = typeof cat.description === "string" ? cat.description : "";
  const raids = Array.isArray(cat.raids)
    ? cat.raids.map(normalizeRaidEntry).filter((entry): entry is RaidEntry => entry !== null)
    : [];

  return { id: cat.id, name, description, raids };
}

export async function loadRaidCategories(): Promise<RaidCategory[]> {
  const res = await fetch("/api/raids");
  if (!res.ok) throw new Error(`Failed to load raid list: ${res.status}`);
  const json: unknown = await res.json();
  if (!Array.isArray(json)) throw new Error("Invalid raid list");

  let total = 0;
  const categories: RaidCategory[] = [];
  for (const value of json) {
    const category = normalizeCategory(value);
    if (!category) continue;
    category.raids = category.raids.slice(0, MAX_RAIDS - total);
    total += category.raids.length;
    categories.push(category);
  }
  return categories;
}

export function showLanding(): Promise<string> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "yas-menu";

    const panel = createElement("div", "yas-menu-panel");
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const cleanup = () => {
      overlay.remove();
    };

    const createSession = () => {
      const candidate = crypto.randomUUID();
      const parsed = SessionIdSchema.safeParse(candidate.trim().toLowerCase());
      if (!parsed.success) throw new Error("Failed to create session id");

      history.replaceState(null, "", `?s=${encodeURIComponent(parsed.data)}`);
      cleanup();
      resolve(parsed.data);
    };

    const createBtn = createElement("button", "yas-menu-start", "CREATE NEW SESSION");
    createBtn.id = "yas-menu-start-btn";
    createBtn.addEventListener("click", createSession);

    panel.append(
      createElement("div", "yas-menu-title", "YET ANOTHER SIM"),
      createElement("div", "yas-menu-subtitle", "CREATE SESSION"),
      createElement("div", "yas-landing-note", "A UUID session link will be created. Copy the page URL to invite others."),
      createBtn,
    );
    createBtn.focus();
  });
}

function playbackStateForLobby(status: LobbyStatus): PlaybackState {
  if (status === "running" || status === "lobby") return "playing";
  if (status === "paused") return "paused";
  if (status === "done") return "done";
  return "stopped";
}

export async function showLobby(net: NetClient, sessionId: string): Promise<{ world: World; yourPlayerId: string | null; sessionId: string; raidId: string; isHost: boolean; playbackState: PlaybackState }> {
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
    };

    const renderHeader = (subtitle: string) => {
      panel.replaceChildren(
        createElement("div", "yas-menu-title", "YET ANOTHER SIM"),
        createElement("div", "yas-menu-subtitle", subtitle),
      );
    };

    const renderSlot = (slot: LobbySlot, claimedByMe: boolean, observingByMe: boolean): HTMLElement => {
      const row = createElement("div", "yas-lobby-slot");
      const meta = createElement("div", "yas-lobby-slot-meta");
      meta.append(
        createElement("span", "yas-lobby-slot-id", slot.playerId),
        createElement("span", "yas-lobby-slot-role", slot.role.toUpperCase()),
      );

      const status = slot.claimedByYou ? "YOU" : slot.claimed ? "CLAIMED" : "BOT";
      const action = createElement("button", "yas-lobby-slot-action", slot.claimedByYou ? "RELEASE" : "CLAIM");
      action.disabled = (slot.claimed && !slot.claimedByYou) || (!slot.claimedByYou && (claimedByMe || observingByMe));
      action.addEventListener("click", () => {
        net.send(slot.claimedByYou
          ? { type: "releaseSlot", playerId: slot.playerId }
          : { type: "claimSlot", playerId: slot.playerId });
      });

      row.append(meta, createElement("div", "yas-lobby-slot-status", status), action);
      return row;
    };

    const renderObserverSlot = (message: LobbyMessage, claimedByMe: boolean): HTMLElement => {
      const row = createElement("div", "yas-lobby-slot");
      const meta = createElement("div", "yas-lobby-slot-meta");
      meta.append(
        createElement("span", "yas-lobby-slot-id", "obs"),
        createElement("span", "yas-lobby-slot-role", "OBSERVER"),
      );

      const status = message.observingByYou ? "YOU" : `${message.observerCount}/${message.maxObservers}`;
      const action = createElement("button", "yas-lobby-slot-action", message.observingByYou ? "RELEASE" : "CLAIM");
      action.disabled = !message.observingByYou && (claimedByMe || message.observerCount >= message.maxObservers);
      action.addEventListener("click", () => {
        net.send(message.observingByYou ? { type: "releaseObserver" } : { type: "claimObserver" });
      });

      row.append(meta, createElement("div", "yas-lobby-slot-status", status), action);
      return row;
    };

    const renderLobby = (message: LobbyMessage) => {
      lastLobby = message;
      const subtitle = message.status === "lobby"
        ? `${message.raidName.toUpperCase()} — CLAIM PARTY SLOT`
        : message.status === "running"
          ? `${message.raidName.toUpperCase()} — IN PROGRESS, CLAIM TO JOIN`
          : message.status === "paused"
            ? `${message.raidName.toUpperCase()} — PAUSED, CLAIM TO JOIN`
            : message.status === "stopped"
              ? `${message.raidName.toUpperCase()} — STOPPED`
              : `${message.raidName.toUpperCase()} — FINISHED`;
      renderHeader(subtitle);

      const claimedByMe = message.slots.some(slot => slot.claimedByYou);
      const slotList = createElement("div", "yas-lobby-slots");
      const slotsById = new Map(message.slots.map(slot => [slot.playerId, slot]));
      for (const playerId of LOBBY_SLOT_ORDER) {
        const slot = slotsById.get(playerId);
        if (slot) slotList.appendChild(renderSlot(slot, claimedByMe, message.observingByYou));
      }
      slotList.appendChild(renderObserverSlot(message, claimedByMe));

      const isHost = net.clientId === message.hostClientId;
      const canStart = message.status === "lobby" && (message.slots.some(slot => slot.claimed) || message.observingByYou);
      const canResume = message.status === "paused" && (claimedByMe || message.observingByYou);
      const canPlayStopped = message.status === "stopped" && (claimedByMe || message.observingByYou);
      const startLabel = message.status !== "lobby"
        ? message.status === "running"
          ? "IN PROGRESS"
          : message.status === "paused"
            ? "RESUME"
            : message.status === "stopped"
              ? "START"
              : "FINISHED"
        : isHost ? "START" : "WAIT HOST";
      const startBtn = createElement("button", "yas-menu-start", startLabel);
      startBtn.disabled = !isHost || (message.status === "paused" ? !canResume : message.status === "stopped" ? !canPlayStopped : !canStart);
      startBtn.addEventListener("click", () => net.send(message.status === "paused" || message.status === "stopped" ? { type: "play" } : { type: "start" }));

      const sessionEl = createElement("div", "yas-menu-session");
      sessionEl.append(
        createElement("span", "yas-menu-session-label", "SESSION"),
        createElement("span", "yas-menu-session-id", sessionId),
        createElement("span", "yas-menu-note", `OBSERVERS ${message.observerCount}/${message.maxObservers}`),
      );

      if (message.status === "lobby") {
        panel.append(sessionEl, slotList, startBtn);
      } else {
        panel.append(slotList, sessionEl, startBtn);
      }
    };

    let lastLobby: LobbyMessage | null = null;

    const disposers = [
      net.on("lobby", renderLobby),
      net.on("started", message => {
        const raidId = lastLobby?.raidId ?? EMPTY_RAID_ID;
        const isHost = net.clientId !== null && net.clientId === lastLobby?.hostClientId;
        const playbackState = playbackStateForLobby(lastLobby?.status ?? "lobby");
        cleanup();
        resolve({ world: message.world, yourPlayerId: message.yourPlayerId, sessionId, raidId, isHost, playbackState });
      }),
      net.on("error", message => showError(message.message)),
    ];

    renderHeader("WAITING FOR LOBBY");
    net.send({ type: "join", sessionId, raidId: EMPTY_RAID_ID });
  });
}
