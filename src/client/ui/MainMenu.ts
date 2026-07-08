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
  type Frame,
  type ServerMessage,
  type DecisionDescription,
} from "@shared/protocol";
import type { World } from "@shared/types";
import type { NetClient } from "../net";
import { createElement } from "./dom";
import { maybeShowWelcomeModal } from "./WelcomeModal";

declare const __YAS_STATIC__: boolean | undefined;

const LOBBY_SLOT_ORDER = ["mt", "ot", "h1", "h2", "m1", "m2", "r1", "r2"] as const;

type LobbyMessage = Extract<ServerMessage, { type: "lobby" }>;
type ReplaySummary = { pull: number; raidId: string; ticks: number };
type ReplayData = { raidId: string; world: World; frames: Frame[] };
const replayCache = new Map<string, ReplayData>();
const REPLAY_CACHE_MAX = 5;

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
  let json: unknown;
  if (typeof __YAS_STATIC__ !== "undefined" && __YAS_STATIC__) {
    json = (await import("../staticRaids.generated")).RAID_CATALOG;
  } else {
    const res = await fetch("/api/raids");
    if (!res.ok) throw new Error(`Failed to load raid list: ${res.status}`);
    json = await res.json();
  }
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

async function loadReplayList(sessionId: string): Promise<ReplaySummary[]> {
  if (typeof __YAS_STATIC__ !== "undefined" && __YAS_STATIC__) return [];
  const res = await fetch(`/api/replays/${encodeURIComponent(sessionId)}`);
  if (!res.ok) return [];
  const json: unknown = await res.json();
  if (!Array.isArray(json)) return [];
  return json.filter((row): row is ReplaySummary => {
    const replay = row as Partial<ReplaySummary>;
    return Number.isInteger(replay.pull) && typeof replay.raidId === "string" && Number.isInteger(replay.ticks);
  });
}

async function loadReplay(sessionId: string, pull: number): Promise<ReplayData> {
  const key = `${sessionId}:${pull}`;
  const cached = replayCache.get(key);
  if (cached) return cached;

  const res = await fetch(`/api/replays/${encodeURIComponent(sessionId)}/${pull}`);
  if (!res.ok) throw new Error(`Failed to load replay: ${res.status}`);
  const replay = await res.json() as ReplayData;
  replayCache.set(key, replay);
  if (replayCache.size > REPLAY_CACHE_MAX) replayCache.delete(replayCache.keys().next().value!);
  return replay;
}

export function showLanding(options?: { notice?: string }): Promise<string> {
  return new Promise((resolve) => {
    const landingNote = typeof __YAS_STATIC__ !== "undefined" && __YAS_STATIC__
      ? "Single-player practice build — online multiplayer is not available. Your session runs entirely in this browser."
      : "A UUID session link will be created. Copy the page URL to invite others.";
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
      createElement("div", "yas-landing-note", landingNote),
    );
    if (options?.notice) panel.appendChild(createElement("div", "yas-menu-error", options.notice));
    panel.appendChild(createBtn);
    createBtn.focus();
  });
}

function playbackStateForLobby(status: LobbyStatus): PlaybackState {
  if (status === "running" || status === "lobby") return "playing";
  if (status === "paused") return "paused";
  if (status === "done") return "done";
  return "stopped";
}

type LobbyResult =
  | { kind: "started"; world: World; yourPlayerId: string | null; sessionId: string; raidId: string; isHost: boolean; playbackState: PlaybackState; seedOverride: number | null; rngDecisions: DecisionDescription[] }
  | { kind: "replay"; pull: number; raidId: string; world: World; frames: Frame[] }
  | { kind: "expired" };

export async function showLobby(net: NetClient, sessionId: string): Promise<LobbyResult> {
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
      closed = true;
      for (const dispose of disposers) dispose();
      document.removeEventListener("keydown", onReplayKeydown);
      replayModal.remove();
      overlay.remove();
    };

    const renderHeader = (subtitle: string) => {
      panel.replaceChildren(
        createElement("div", "yas-menu-title", "YET ANOTHER SIM"),
        createElement("div", "yas-menu-subtitle", subtitle),
      );
    };

    const renderReplays = (): HTMLElement => {
      const openBtn = createElement("button", "yas-menu-start", replays ? `REPLAYS (${replays.length})` : "REPLAYS");
      openBtn.disabled = !replays || replays.length === 0;
      openBtn.addEventListener("click", openReplayModal);
      const wrapper = createElement("div", "yas-lobby-replays");
      wrapper.appendChild(openBtn);
      return wrapper;
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

    const replayModal = createElement("div");
    replayModal.id = "yas-replay-modal";
    replayModal.style.display = "none";
    const replaySearch = document.createElement("input");
    replaySearch.className = "yas-raid-search";
    replaySearch.type = "search";
    replaySearch.placeholder = "Search replays...";
    replaySearch.ariaLabel = "Search replays";
    const replayList = createElement("div", "yas-raid-raid-list");
    const replayHeader = createElement("div", "yas-raid-modal-header");
    replayHeader.append(createElement("div", "yas-menu-subtitle", "WATCH REPLAY"), replaySearch);
    const replayPanel = createElement("div", "yas-raid-modal-panel");
    replayPanel.append(replayHeader, replayList);
    replayModal.appendChild(replayPanel);
    document.body.appendChild(replayModal);

    const watchReplay = async (replay: ReplaySummary, action: HTMLButtonElement) => {
      action.disabled = true;
      try {
        const loaded = await loadReplay(sessionId, replay.pull);
        cleanup();
        resolve({ kind: "replay", pull: replay.pull, raidId: loaded.raidId, world: loaded.world, frames: loaded.frames });
      } catch {
        action.disabled = false;
        showError("Failed to load replay");
      }
    };

    const renderReplayModal = () => {
      const q = replaySearch.value.trim().toLowerCase();
      const matches = (replays ?? []).filter(replay =>
        `pull ${replay.pull}`.includes(q)
        || replay.raidId.toLowerCase().includes(q)
        || `${Math.round(replay.ticks / 60)}s`.includes(q));
      replayList.replaceChildren();
      if (matches.length === 0) {
        replayList.appendChild(createElement("div", "yas-raid-empty", "No replays match"));
        return;
      }
      for (const replay of matches) {
        const row = createElement("button", "yas-raid-raid-option");
        row.type = "button";
        row.append(
          createElement("span", "yas-raid-raid-name", `Pull ${replay.pull}`),
          createElement("span", "yas-raid-raid-cat", `${replay.raidId} - ${Math.round(replay.ticks / 60)}s`),
        );
        row.addEventListener("click", () => watchReplay(replay, row));
        replayList.appendChild(row);
      }
    };

    const openReplayModal = () => {
      replaySearch.value = "";
      renderReplayModal();
      replayModal.style.display = "flex";
      replaySearch.focus();
    };

    const closeReplayModal = () => {
      replayModal.style.display = "none";
    };

    replaySearch.addEventListener("input", renderReplayModal);
    replayModal.addEventListener("click", event => { if (event.target === replayModal) closeReplayModal(); });
    const onReplayKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeReplayModal();
    };
    document.addEventListener("keydown", onReplayKeydown);

    const renderLobby = (message: LobbyMessage) => {
      lastLobby = message;
      const isDefaultLobby = message.raidId === EMPTY_RAID_ID;
      const subtitle = message.status === "lobby"
        ? `${message.raidName.toUpperCase()} — CLAIM PARTY SLOT`
        : isDefaultLobby && message.status === "running"
          ? `${message.raidName.toUpperCase()} — JOINABLE LOBBY`
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
      const canRestartDone = message.status === "done" && (claimedByMe || message.observingByYou);
      const startLabel = message.status !== "lobby"
        ? isDefaultLobby && message.status === "running"
          ? "LOBBY ACTIVE"
        : message.status === "running"
          ? "IN PROGRESS"
          : message.status === "paused"
            ? "RESUME"
            : message.status === "stopped"
              ? "START"
              : "RESTART"
        : isHost ? "START" : "WAIT HOST";
      const startBtn = createElement("button", "yas-menu-start", startLabel);
      startBtn.disabled = !isHost || (message.status === "paused" ? !canResume : message.status === "stopped" ? !canPlayStopped : message.status === "done" ? !canRestartDone : !canStart);
      startBtn.addEventListener("click", () => net.send(message.status === "done" ? { type: "restart" } : message.status === "paused" || message.status === "stopped" ? { type: "play" } : { type: "start" }));

      const sessionEl = createElement("div", "yas-menu-session");
      sessionEl.append(
        createElement("span", "yas-menu-session-label", "SESSION"),
        createElement("span", "yas-menu-session-id", sessionId),
        createElement("span", "yas-menu-note", `OBSERVERS ${message.observerCount}/${message.maxObservers}`),
      );

      if (message.status === "lobby") {
        panel.append(sessionEl, slotList, startBtn, renderReplays());
      } else {
        panel.append(slotList, sessionEl, startBtn, renderReplays());
      }

      if (!welcomeShown) {
        welcomeShown = true;
        maybeShowWelcomeModal();
      }
    };

    let lastLobby: LobbyMessage | null = null;
    let replays: ReplaySummary[] | null = null;
    let closed = false;
    let welcomeShown = false;

    const disposers = [
      net.on("lobby", renderLobby),
      net.on("started", message => {
        const raidId = lastLobby?.raidId ?? EMPTY_RAID_ID;
        const isHost = net.clientId !== null && net.clientId === lastLobby?.hostClientId;
        const playbackState = playbackStateForLobby(lastLobby?.status ?? "lobby");
        cleanup();
        resolve({ kind: "started", world: message.world, yourPlayerId: message.yourPlayerId, sessionId, raidId, isHost, playbackState, seedOverride: lastLobby?.seedOverride ?? null, rngDecisions: lastLobby?.rngDecisions ?? [] });
      }),
      net.on("sessionExpired", () => {
        cleanup();
        resolve({ kind: "expired" });
      }),
      net.on("error", message => showError(message.message)),
    ];

    renderHeader("WAITING FOR LOBBY");
    void loadReplayList(sessionId).catch(() => []).then(list => {
      if (closed) return;
      replays = list;
      if (lastLobby) renderLobby(lastLobby);
    });
    net.send({ type: "join", sessionId, raidId: EMPTY_RAID_ID });
  });
}
