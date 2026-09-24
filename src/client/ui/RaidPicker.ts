import type { RaidCategory } from "@model/protocol";
import { el } from "./dom";

export interface RaidPicker {
  button: HTMLButtonElement;
  setRaidId: (raidId: string) => void;
  setEnabled: (enabled: boolean) => void;
  dispose: () => void;
}

// Shown on the button before anything is picked. It is a prompt, never a row in the browser — every
// option the list offers is a real raid.
export const UNSELECTED_LABEL = "SELECT RAID";

// An unselected or unknown raid id opens on the first category rather than inventing one.
export function categoryForRaidId(categories: RaidCategory[], raidId: string): RaidCategory | null {
  const separator = raidId.indexOf("/");
  const prefix = separator === -1 ? null : raidId.slice(0, separator);
  return (prefix === null ? null : categories.find(cat => cat.id === prefix)) ?? categories[0] ?? null;
}

export function raidLabelForId(categories: RaidCategory[], raidId: string): string {
  for (const category of categories) {
    const raid = category.raids.find(entry => entry.id === raidId);
    if (raid) return raid.name;
  }
  return UNSELECTED_LABEL;
}

// Raid browser: a labelled trigger button plus a searchable category/raid modal.
export function createRaidPicker(options: {
  categories: RaidCategory[];
  initialRaidId: string;
  enabled: boolean;
  onSelect: (raidId: string) => void;
}): RaidPicker {
  const categories = options.categories;
  let selectedRaidId = options.initialRaidId;
  let currentCategory = categoryForRaidId(categories, selectedRaidId);
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

  const updateButtonLabel = () => {
    raidName.textContent = raidLabelForId(categories, selectedRaidId);
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
      row.classList.toggle("is-active", normalizedSearch === "" && category.id === currentCategory?.id);
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
    const active = currentCategory;
    const matches = normalizedSearch === "" && active
      ? active.raids.map(raid => ({ category: active, raid }))
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
    currentCategory = categoryForRaidId(categories, selectedRaidId);
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
      currentCategory = categoryForRaidId(categories, raidId);
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
    dispose: () => {
      document.removeEventListener("keydown", onKeydown);
      modal.remove();
    },
  };
}
