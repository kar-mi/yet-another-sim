import { EMPTY_RAID_ID, type PlaybackState, type RaidCategory } from "../../shared/protocol";
import type { NetClient } from "../net";
import { loadRaidCategories } from "./MainMenu";
import { el } from "./dom";

/**
 * In-sim HUD: raid category modal + raid-plan dropdown + playback controls.
 * Returns a disposer that tears down listeners and DOM.
 */
export async function createRaidHudSelect(net: NetClient, initialRaidId: string, initialIsHost: boolean, initialPlaybackState: PlaybackState = "playing"): Promise<() => void> {
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

  const categoryBtn = el("button", {
    type: "button",
    id: "yas-raid-category-btn",
    textContent: "☰",
    ariaLabel: "Choose raid category",
  });

  const label = el("span", { className: "yas-session-label", textContent: "RAID" });

  const selectDropdown = el("div", { className: "yas-raid-dropdown" });
  const select = el("button", {
    type: "button",
    className: "yas-raid-dropdown-toggle",
    ariaLabel: "Raid plan",
    disabled: !isHost,
    attrs: { "aria-haspopup": "listbox", "aria-expanded": "false" },
  });
  const selectOptions = el("div", {
    className: "yas-raid-dropdown-options",
    attrs: { role: "listbox" },
  });
  selectOptions.style.display = "none";
  let activeRaidId = initialRaidId;
  let selectedRaidId = initialRaidId;
  let raidChangePending = false;
  let syncPlayback: (state: PlaybackState) => void = () => {};
  const setSelectOpen = (open: boolean) => {
    if (open && select.disabled) return;
    selectOptions.style.display = open ? "flex" : "none";
    select.setAttribute("aria-expanded", String(open));
  };
  const updateSelectedRaidLabel = (category: RaidCategory) => {
    const selectedRaid = category.raids.find(raid => raid.id === selectedRaidId);
    select.textContent = selectedRaid?.name ?? category.raids[0]?.name ?? "";
  };
  const updateOptionSelection = () => {
    selectOptions.querySelectorAll<HTMLButtonElement>(".yas-raid-dropdown-option").forEach(option => {
      option.setAttribute("aria-selected", String(option.value === selectedRaidId));
    });
  };
  const requestRaidChange = (raidId: string) => {
    if (!raidId) return;
    selectedRaidId = raidId;
    updateSelectedRaidLabel(currentCategory);
    updateOptionSelection();
    setSelectOpen(false);
    select.blur();
    if (raidId === activeRaidId) return;
    raidChangePending = true;
    syncPlayback(lastState);
    net.send({ type: "setRaid", raidId });
  };
  const populateSelect = (category: RaidCategory, selectedId: string) => {
    selectedRaidId = selectedId;
    selectOptions.replaceChildren();
    updateSelectedRaidLabel(category);
    for (const raid of category.raids) {
      const option = el("button", {
        type: "button",
        className: "yas-raid-dropdown-option",
        value: raid.id,
        textContent: raid.name,
        attrs: { role: "option", "aria-selected": String(raid.id === selectedRaidId) },
      });
      option.addEventListener("click", () => {
        requestRaidChange(raid.id);
      });
      selectOptions.appendChild(option);
    }
  };
  populateSelect(currentCategory, initialRaidId);
  select.addEventListener("click", () => {
    setSelectOpen(selectOptions.style.display === "none");
  });
  selectDropdown.append(select, selectOptions);

  // Modal listing categories; picking one re-scopes the dropdown (does not change the active raid).
  const modal = el("div", { id: "yas-raid-modal" });
  modal.style.display = "none";
  const modalPanel = el("div", { className: "yas-raid-modal-panel" }, [
    el("div", { className: "yas-menu-subtitle", textContent: "CHOOSE CATEGORY" }),
  ]);
  const closeModal = () => { modal.style.display = "none"; };
  for (const category of categories) {
    const row = el("button", { type: "button", className: "yas-raid-cat-option" }, [
      el("div", { className: "yas-raid-cat-name", textContent: category.name }),
      el("div", { className: "yas-raid-cat-desc", textContent: category.description }),
    ]);
    row.addEventListener("click", () => {
      currentCategory = category;
      const raidId = category.raids[0]?.id ?? "";
      populateSelect(category, raidId);
      requestRaidChange(raidId);
      closeModal();
    });
    modalPanel.appendChild(row);
  }
  modal.appendChild(modalPanel);
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeModal();
      setSelectOpen(false);
    }
  };
  const onDocumentClick = (event: MouseEvent) => {
    if (!selectDropdown.contains(event.target as Node)) setSelectOpen(false);
  };
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("click", onDocumentClick);
  document.body.appendChild(modal);

  categoryBtn.addEventListener("click", () => {
    categoryBtn.blur();
    modal.style.display = "flex";
  });

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
    const locked = raidChangePending || !isHost || state === "playing";
    select.disabled = locked;
    if (locked) setSelectOpen(false);
    categoryBtn.disabled = locked;
    playBtn.disabled = raidChangePending || !isHost || state === "playing";
    pauseBtn.disabled = raidChangePending || !isHost || state !== "playing";
    stopBtn.disabled = raidChangePending || !isHost || state === "stopped";
    restartBtn.disabled = raidChangePending || !isHost;
  };

  const disposePlayback = net.on("playback", message => {
    isHost = net.clientId === message.hostClientId;
    activeRaidId = message.raidId;
    raidChangePending = false;
    currentCategory = categoryForRaidId(message.raidId);
    populateSelect(currentCategory, message.raidId);
    syncPlayback(message.state);
  });
  const disposeError = net.on("error", () => {
    raidChangePending = false;
    currentCategory = categoryForRaidId(activeRaidId);
    populateSelect(currentCategory, activeRaidId);
    syncPlayback(lastState);
  });
  syncPlayback(initialPlaybackState);

  const selectRow = el("div", { className: "yas-raid-select-row" });
  selectRow.append(categoryBtn, selectDropdown);
  wrapper.append(label, selectRow, controls);
  document.body.appendChild(wrapper);
  return () => {
    disposePlayback();
    disposeError();
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("click", onDocumentClick);
    modal.remove();
    wrapper.remove();
  };
}
