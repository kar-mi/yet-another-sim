import { EMPTY_RAID_ID, type PlaybackState, type RaidCategory } from "@shared/protocol";
import { RAID_CHANGE_START_DELAY_MS } from "@shared/constants";
import type { NetClient } from "../net";
import { loadRaidCategories } from "./MainMenu";
import { showLoadingOverlay } from "./LoadingOverlay";
import { el } from "./dom";
import type { HudLayoutManager } from "./HudLayoutManager";

/**
 * In-sim HUD: raid picker modal + playback controls.
 * Returns a disposer that tears down listeners and DOM.
 */
export async function createRaidHudSelect(net: NetClient, initialRaidId: string, initialIsHost: boolean, initialPlaybackState: PlaybackState, hudLayout: HudLayoutManager): Promise<() => void> {
  let isHost = initialIsHost;
  let lastState: PlaybackState = initialPlaybackState;
  const defaultLobbyCategory: RaidCategory = {
    id: "default-lobby",
    name: "Default Lobby",
    description: "Empty arena.",
    raids: [{ id: EMPTY_RAID_ID, name: "Default Lobby" }],
  };
  const categories = [defaultLobbyCategory, ...await loadRaidCategories()];
  const categoryForRaidId = (raidId: string): RaidCategory => {
    if (raidId === EMPTY_RAID_ID) return defaultLobbyCategory;
    const prefix = raidId.slice(0, raidId.indexOf("/"));
    return categories.find(cat => cat.id === prefix) ?? defaultLobbyCategory;
  };
  let currentCategory = categoryForRaidId(initialRaidId);

  const wrapper = el("div", { id: "yas-raid-select" });

  const label = el("span", { className: "yas-session-label", textContent: "RAID" });

  const raidName = el("span", { className: "yas-raid-open-name" });
  const raidBtn = el("button", {
    type: "button",
    className: "yas-raid-open",
    disabled: !isHost,
    attrs: { "aria-haspopup": "dialog", "aria-expanded": "false" },
  }, [
    raidName,
    el("span", { className: "yas-raid-open-glyph", textContent: "▾" }),
  ]);
  let activeRaidId = initialRaidId;
  let selectedRaidId = initialRaidId;
  let raidChangePending = false;
  let resumePlaybackAfterModal = false;
  let searchTerm = "";
  let syncPlayback: (state: PlaybackState) => void = () => {};

  const raidLabelForId = (raidId: string): string => {
    const category = categoryForRaidId(raidId);
    return category.raids.find(raid => raid.id === raidId)?.name ?? category.raids[0]?.name ?? "";
  };
  const updateButtonLabel = () => {
    raidName.textContent = raidLabelForId(selectedRaidId);
  };

  const modal = el("div", { id: "yas-raid-modal" });
  modal.style.display = "none";
  const searchInput = el("input", {
    className: "yas-raid-search",
    type: "search",
    placeholder: "Search raids...",
    ariaLabel: "Search raids",
  });
  const catList = el("div", { className: "yas-raid-cat-list" });
  const raidList = el("div", { className: "yas-raid-raid-list", attrs: { role: "listbox" } });
  const modalPanel = el("div", { className: "yas-raid-modal-panel" }, [
    el("div", { className: "yas-raid-modal-header" }, [
      el("div", { className: "yas-menu-subtitle", textContent: "SELECT RAID" }),
      searchInput,
    ]),
    el("div", { className: "yas-raid-modal-body" }, [
      catList,
      raidList,
    ]),
  ]);
  modal.appendChild(modalPanel);

  const renderCategories = () => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    catList.replaceChildren();
    for (const category of categories) {
      const hasMatch = normalizedSearch === ""
        || category.name.toLowerCase().includes(normalizedSearch)
        || category.raids.some(raid => raid.name.toLowerCase().includes(normalizedSearch));
      const row = el("button", { type: "button", className: "yas-raid-cat-option" }, [
        el("div", { className: "yas-raid-cat-name", textContent: category.name }),
        el("div", { className: "yas-raid-cat-desc", textContent: category.description }),
      ]);
      row.classList.toggle("is-active", normalizedSearch === "" && category.id === currentCategory.id);
      row.classList.toggle("is-dim", normalizedSearch !== "" && !hasMatch);
      row.addEventListener("click", () => {
        searchTerm = "";
        searchInput.value = "";
        currentCategory = category;
        renderCategories();
        renderRaids();
      });
      catList.appendChild(row);
    }
  };

  const renderRaids = () => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const matches = normalizedSearch === ""
      ? currentCategory.raids.map(raid => ({ category: currentCategory, raid }))
      : categories.flatMap(category => category.raids
        .filter(raid => raid.name.toLowerCase().includes(normalizedSearch) || category.name.toLowerCase().includes(normalizedSearch))
        .map(raid => ({ category, raid })));
    raidList.replaceChildren();
    if (matches.length === 0) {
      raidList.appendChild(el("div", { className: "yas-raid-empty", textContent: "No raids match" }));
      return;
    }
    for (const { category, raid } of matches) {
      const row = el("button", {
        type: "button",
        className: "yas-raid-raid-option",
        attrs: { role: "option", "aria-selected": String(raid.id === activeRaidId) },
      }, [
        el("span", { className: "yas-raid-raid-name", textContent: raid.name }),
        el("span", { className: "yas-raid-raid-cat", textContent: category.name }),
      ]);
      row.classList.toggle("is-active", raid.id === activeRaidId);
      row.addEventListener("click", () => {
        requestRaidChange(raid.id);
      });
      raidList.appendChild(row);
    }
  };

  const openModal = () => {
    if (raidBtn.disabled) return;
    resumePlaybackAfterModal = lastState === "playing";
    if (resumePlaybackAfterModal) net.send({ type: "pause" });
    searchTerm = "";
    searchInput.value = "";
    currentCategory = categoryForRaidId(activeRaidId);
    renderCategories();
    renderRaids();
    modal.style.display = "flex";
    raidBtn.setAttribute("aria-expanded", "true");
    searchInput.focus();
  };
  const closeModal = (resumePlayback = true) => {
    const wasOpen = modal.style.display !== "none";
    modal.style.display = "none";
    raidBtn.setAttribute("aria-expanded", "false");
    if (!wasOpen || !resumePlayback || !resumePlaybackAfterModal || raidChangePending) return;
    resumePlaybackAfterModal = false;
    net.send({ type: "play" });
  };

  const requestRaidChange = (raidId: string) => {
    if (!raidId) return;
    selectedRaidId = raidId;
    updateButtonLabel();
    raidBtn.blur();
    if (raidId === activeRaidId) {
      closeModal();
      return;
    }
    raidChangePending = true;
    closeModal(false);
    syncPlayback(lastState);
    net.send({ type: "setRaid", raidId });
  };

  updateButtonLabel();
  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value;
    renderCategories();
    renderRaids();
  });
  raidBtn.addEventListener("click", openModal);
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeModal();
    }
  };
  document.addEventListener("keydown", onKeydown);
  document.body.appendChild(modal);

  const controls = el("div", { className: "yas-playback-controls" });
  const makePlaybackBtn = (labelText: string, onClick: () => void) => {
    const btn = el("button", { type: "button", textContent: labelText, disabled: !isHost });
    btn.addEventListener("click", () => {
      btn.blur();
      onClick();
    });
    return btn;
  };
  const playBtn = makePlaybackBtn("PLAY", () => net.send({ type: "play" }));
  const pauseBtn = makePlaybackBtn("PAUSE", () => net.send({ type: "pause" }));
  const stopBtn = makePlaybackBtn("STOP", () => net.send({ type: "stop" }));
  const restartBtn = makePlaybackBtn("RESTART", () => net.send({ type: "restart" }));
  controls.append(playBtn, pauseBtn, stopBtn, restartBtn);

  syncPlayback = (state: PlaybackState) => {
    lastState = state;
    const locked = raidChangePending || !isHost;
    raidBtn.disabled = locked;
    if (locked) closeModal(false);
    // Play can't resume a finished pull (the server rejects it) — steer the host to RESTART instead.
    playBtn.disabled = raidChangePending || !isHost || state === "playing" || state === "done";
    pauseBtn.disabled = raidChangePending || !isHost || state !== "playing";
    stopBtn.disabled = raidChangePending || !isHost || state === "stopped";
    restartBtn.disabled = raidChangePending || !isHost;
  };

  const disposePlayback = net.on("playback", message => {
    isHost = net.clientId === message.hostClientId;
    if (message.raidId !== activeRaidId) showLoadingOverlay(RAID_CHANGE_START_DELAY_MS);
    const wasRaidChangePending = raidChangePending;
    activeRaidId = message.raidId;
    raidChangePending = false;
    if (wasRaidChangePending || message.state === "playing") resumePlaybackAfterModal = false;
    currentCategory = categoryForRaidId(message.raidId);
    selectedRaidId = message.raidId;
    updateButtonLabel();
    if (modal.style.display !== "none") {
      renderCategories();
      renderRaids();
    }
    syncPlayback(message.state);
  });
  const disposeError = net.on("error", () => {
    const shouldResume = resumePlaybackAfterModal;
    raidChangePending = false;
    resumePlaybackAfterModal = false;
    currentCategory = categoryForRaidId(activeRaidId);
    selectedRaidId = activeRaidId;
    updateButtonLabel();
    if (modal.style.display !== "none") {
      renderCategories();
      renderRaids();
    }
    syncPlayback(lastState);
    if (shouldResume) net.send({ type: "play" });
  });
  syncPlayback(initialPlaybackState);

  const selectRow = el("div", { className: "yas-raid-select-row" });
  selectRow.append(raidBtn);
  wrapper.append(label, selectRow, controls);
  document.body.appendChild(wrapper);
  hudLayout.register("raidselector", wrapper);
  return () => {
    disposePlayback();
    disposeError();
    document.removeEventListener("keydown", onKeydown);
    modal.remove();
    hudLayout.unregister("raidselector");
    wrapper.remove();
  };
}
