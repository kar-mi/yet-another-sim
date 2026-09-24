import type { Frame } from "@model/protocol";
import type { ReplaySummary } from "@model/replay";
import type { World } from "@model/types";
import { replayRepository, ReplayRepositoryError } from "../replayRepository";
import { createElement, el } from "./dom";

export interface LoadedReplay {
  pull: number;
  raidId: string;
  world: World;
  frames: Frame[];
}

export interface ReplayBrowser {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  dispose: () => void;
}

export function replayMatches(replay: ReplaySummary, query: string): boolean {
  if (query === "") return true;
  return `pull ${replay.pull}`.includes(query)
    || replay.raidId.toLowerCase().includes(query)
    || `${Math.round(replay.ticks / 60)}s`.includes(query);
}

export function createReplayBrowser(sessionId: string, onWatch: (replay: LoadedReplay) => void): ReplayBrowser {
  let replays: ReplaySummary[] | null = null;
  let open = false;
  let generation = 0;

  const search = el("input", {
    className: "yas-raid-search",
    type: "search",
    placeholder: "Search replays...",
    ariaLabel: "Search replays",
  });
  const list = createElement("div", "yas-raid-raid-list");
  const backBtn = createElement("button", "yas-menu-start", "BACK TO SIMULATOR");
  backBtn.type = "button";
  const modal = el("div", { id: "yas-replay-modal" }, [
    el("div", { className: "yas-raid-modal-panel" }, [
      el("div", { className: "yas-raid-modal-header" }, [
        createElement("div", "yas-menu-subtitle", "SESSION RECORDINGS"),
        search,
      ]),
      list,
      el("div", { className: "yas-replay-modal-footer" }, [backBtn]),
    ]),
  ]);
  modal.style.display = "none";
  document.body.appendChild(modal);

  const showMessage = (text: string, retry: boolean) => {
    list.replaceChildren(createElement("div", "yas-raid-empty", text));
    if (!retry) return;
    const retryBtn = createElement("button", "yas-menu-start", "RETRY");
    retryBtn.type = "button";
    retryBtn.addEventListener("click", () => { void refresh(); });
    list.appendChild(retryBtn);
  };

  const watch = async (replay: ReplaySummary, row: HTMLButtonElement) => {
    const token = generation;
    row.disabled = true;
    try {
      const loaded = await replayRepository.load(sessionId, replay.pull);
      if (token !== generation) return;
      close();
      onWatch({ pull: replay.pull, raidId: loaded.raidId, world: loaded.world, frames: loaded.frames });
    } catch (error) {
      if (token !== generation) return;
      row.disabled = false;
      showMessage(error instanceof ReplayRepositoryError && error.code === "unsupported_format"
        ? "This replay was recorded by an incompatible version"
        : "Failed to load replay", true);
    }
  };

  const render = () => {
    if (replays === null) return;
    if (replays.length === 0) {
      showMessage("No recordings yet — stop a pull to save one", false);
      return;
    }
    const query = search.value.trim().toLowerCase();
    const matches = replays.filter(replay => replayMatches(replay, query));
    list.replaceChildren();
    if (matches.length === 0) {
      list.appendChild(createElement("div", "yas-raid-empty", "No replays match"));
      return;
    }
    for (const replay of matches) {
      const row = createElement("button", "yas-raid-raid-option");
      row.type = "button";
      row.disabled = !replay.supported;
      row.append(
        createElement("span", "yas-raid-raid-name", `Pull ${replay.pull}`),
        createElement("span", "yas-raid-raid-cat", replay.supported
          ? `${replay.raidId} - ${Math.round(replay.ticks / 60)}s`
          : "INCOMPATIBLE REPLAY"),
      );
      row.addEventListener("click", () => { void watch(replay, row); });
      list.appendChild(row);
    }
  };

  const refresh = async () => {
    const token = generation;
    replays = null;
    showMessage("Loading replays...", false);
    try {
      const loaded = await replayRepository.list(sessionId);
      if (token !== generation) return;
      replays = loaded;
      render();
    } catch (error) {
      if (token !== generation) return;
      showMessage(`Failed to load replays: ${error instanceof Error ? error.message : "Unknown error"}`, true);
    }
  };

  function close(): void {
    if (!open) return;
    open = false;
    generation += 1;
    modal.style.display = "none";
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (open && event.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  search.addEventListener("input", render);
  backBtn.addEventListener("click", close);
  modal.addEventListener("click", event => { if (event.target === modal) close(); });

  return {
    open: () => {
      if (open) return;
      open = true;
      generation += 1;
      search.value = "";
      modal.style.display = "flex";
      void refresh();
      search.focus();
    },
    close,
    isOpen: () => open,
    dispose: () => {
      generation += 1;
      document.removeEventListener("keydown", onKeydown);
      modal.remove();
    },
  };
}
