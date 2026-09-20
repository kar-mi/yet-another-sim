import { EMPTY_RAID_ID, type RaidCategory } from "@shared/protocol";
import { el } from "./dom";

export interface RaidPicker {
  button: HTMLButtonElement;
  setRaidId: (raidId: string) => void;
  setEnabled: (enabled: boolean) => void;
  close: () => void;
  dispose: () => void;
}

// A session starts with no raid picked; the workshop is entered from its own button, not selected here.
const UNSELECTED: RaidCategory = {
  id: "unselected",
  name: "",
  description: "",
  raids: [{ id: EMPTY_RAID_ID, name: "SELECT RAID" }],
};

// Raid browser: a labelled trigger button plus a searchable category/raid modal. Used by the setup
// screen, where the raid for the next pull is chosen.
export function createRaidPicker(options: {
  categories: RaidCategory[];
  initialRaidId: string;
  enabled: boolean;
  onSelect: (raidId: string) => void;
}): RaidPicker {
  const categories = options.categories;
  const categoryForRaidId = (raidId: string): RaidCategory => {
    if (raidId === EMPTY_RAID_ID) return UNSELECTED;
    const prefix = raidId.slice(0, raidId.indexOf("/"));
    return categories.find(cat => cat.id === prefix) ?? categories[0] ?? UNSELECTED;
  };

  let selectedRaidId = options.initialRaidId;
  let currentCategory = categoryForRaidId(selectedRaidId);
  let searchTerm = "";

  const raidName = el("span", { className: "yas-raid-open-name" });
  const button = el("button", {
    type: "button",
    className: "yas-raid-open",
    disabled: !options.enabled,
    attrs: { "aria-haspopup": "dialog", "aria-expanded": "false" },
  }, [
    raidName,
    el("span", { className: "yas-raid-open-glyph", textContent: "▾" }),
  ]);

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
  modal.appendChild(el("div", { className: "yas-raid-modal-panel" }, [
    el("div", { className: "yas-raid-modal-header" }, [
      el("div", { className: "yas-menu-subtitle", textContent: "SELECT RAID" }),
      searchInput,
    ]),
    el("div", { className: "yas-raid-modal-body" }, [
      catList,
      raidList,
    ]),
  ]));

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
        attrs: { role: "option", "aria-selected": String(raid.id === selectedRaidId) },
      }, [
        el("span", { className: "yas-raid-raid-name", textContent: raid.name }),
        el("span", { className: "yas-raid-raid-cat", textContent: category.name }),
      ]);
      row.classList.toggle("is-active", raid.id === selectedRaidId);
      row.addEventListener("click", () => {
        close();
        if (raid.id !== selectedRaidId) options.onSelect(raid.id);
      });
      raidList.appendChild(row);
    }
  };

  const open = () => {
    if (button.disabled) return;
    searchTerm = "";
    searchInput.value = "";
    currentCategory = categoryForRaidId(selectedRaidId);
    renderCategories();
    renderRaids();
    modal.style.display = "flex";
    button.setAttribute("aria-expanded", "true");
    searchInput.focus();
  };
  const close = () => {
    modal.style.display = "none";
    button.setAttribute("aria-expanded", "false");
    button.blur();
  };

  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value;
    renderCategories();
    renderRaids();
  });
  button.addEventListener("click", open);
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && modal.style.display !== "none") close();
  };
  document.addEventListener("keydown", onKeydown);
  document.body.appendChild(modal);
  updateButtonLabel();

  return {
    button,
    setRaidId: raidId => {
      selectedRaidId = raidId;
      currentCategory = categoryForRaidId(raidId);
      updateButtonLabel();
      if (modal.style.display !== "none") {
        renderCategories();
        renderRaids();
      }
    },
    setEnabled: enabled => {
      button.disabled = !enabled;
      if (!enabled) close();
    },
    close,
    dispose: () => {
      document.removeEventListener("keydown", onKeydown);
      modal.remove();
    },
  };
}
