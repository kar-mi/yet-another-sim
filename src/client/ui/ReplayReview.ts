// Replay review UI: the event sidebar and the section navigator, over the insights collected in
// client/replayInsights.ts.
//
// The section navigator is independent of the sidebar's filters, so sections locate you in the
// fight whether or not anything happened to the filtered player.

import type { MechanicSection } from "@shared/types";
import type { ReplayInsights } from "@shared/replay";
import {
  buildRows, damageLabel, eventSeekTick, matchesFilter, rowLabel, sectionSeekTick, ticksToLabel,
  type ReplayFilter, type ReviewRow,
} from "../replayReviewModel";
import { createDropdown, type Dropdown } from "./Dropdown";
import { el } from "./dom";
import type { HudLayoutManager } from "./HudLayoutManager";

export type ReplayReviewControls = {
  duration: () => number;
  currentTick: () => number;
  pause: () => void;
  seek: (tick: number) => void;
  spectate: (playerId: string) => void;
  // False for clients following the host's replay: no section picker, and row clicks only spectate.
  canSeek?: boolean;
};

export type ReplayReview = {
  // Appended under the seek bar by the raid HUD; null when the recording has no sections.
  sections: HTMLElement | null;
  // Called from the playback timer so the current position stays highlighted.
  setPosition: (tick: number) => void;
  dispose: () => void;
};

const FILTERS: readonly (readonly [ReplayFilter, string])[] = [
  ["all", "ALL"],
  ["deaths", "DEATHS"],
  ["hits", "AVOIDABLE HITS"],
];

export function createReplayReview(
  insights: ReplayInsights,
  controls: ReplayReviewControls,
  hudLayout: HudLayoutManager,
): ReplayReview {
  const rows = buildRows(insights.events);
  const rowsById = new Map(rows.map(row => [row.id, row]));
  const sectionNameById = new Map(insights.sections.map(section => [section.id, section.name]));

  const state = { filter: "all" as ReplayFilter, playerId: "", query: "" };
  let selectedId: string | null = null;
  let position = 0;
  // Only a click scrolls the list, so playback highlights never yank the sidebar out from under
  // someone reading it.
  let scrollOnNextRender = false;

  const select = (row: ReviewRow): void => {
    selectedId = row.id;
    scrollOnNextRender = true;
    controls.pause();
    controls.spectate(row.playerId);
    controls.seek(eventSeekTick(row.tick));
    render();
  };

  const search = el("input", {
    className: "yas-review-search",
    type: "search",
    placeholder: "Search player, source, section...",
    ariaLabel: "Search replay events",
  });
  search.addEventListener("input", () => { state.query = search.value.trim().toLowerCase(); render(); });

  const filterRow = el("div", { className: "yas-review-filters", attrs: { role: "group", "aria-label": "Event filter" } });
  const filterButtons = new Map<ReplayFilter, HTMLButtonElement>();
  for (const [value, text] of FILTERS) {
    const button = el("button", { type: "button", className: "yas-review-chip", textContent: text });
    button.addEventListener("click", () => { state.filter = value; render(); });
    filterButtons.set(value, button);
    filterRow.appendChild(button);
  }

  const playerFilter = createDropdown({
    ariaLabel: "Filter by party member",
    placeholder: "All party members",
    className: "yas-review-player",
    options: [
      { value: "", label: "All party members" },
      ...insights.players.map(player => ({ value: player.id, label: player.label })),
    ],
    onSelect: playerId => { state.playerId = playerId; render(); },
  });

  const list = el("div", { className: "yas-review-list", attrs: { role: "list" } });
  const dragHandle = el("div", {
    className: "yas-hud-drag-handle",
    title: "Drag to move",
    attrs: { "aria-hidden": "true" },
  });
  const panel = el("div", { id: "yas-replay-review" }, [
    dragHandle,
    el("span", { className: "yas-session-label", textContent: "EVENTS" }),
    search,
    filterRow,
    playerFilter.element,
    list,
  ]);
  document.body.appendChild(panel);
  hudLayout.register("replayevents", panel, { dragHandle });

  const sectionPicker = controls.canSeek !== false && insights.sections.length > 0 ? createSectionPicker(insights.sections, controls) : null;

  const rowElements = new Map<string, HTMLElement>();

  function emptyMessage(visible: ReviewRow[]): string | null {
    if (rows.length === 0) return "No deaths or avoidable hits in this pull.";
    if (visible.length === 0) return "No events match";
    return null;
  }

  function renderList(visible: ReviewRow[]): void {
    rowElements.clear();
    list.replaceChildren();
    const empty = emptyMessage(visible);
    if (empty !== null) {
      list.appendChild(el("div", { className: "yas-raid-empty", textContent: empty }));
      return;
    }
    for (const row of visible) {
      const damage = damageLabel(row);
      const meta = [row.playerLabel, rowLabel(row), damage].filter(Boolean).join(" · ");
      const button = el("button", {
        type: "button",
        className: `yas-review-row${row.isDeath ? " is-death" : ""}`,
        attrs: { role: "listitem", "aria-label": `${ticksToLabel(row.tick)} ${row.sourceName} — ${meta}` },
      }, [
        el("span", { className: "yas-review-row-time", textContent: ticksToLabel(row.tick) }),
        el("span", { className: "yas-review-row-icon", textContent: row.isDeath ? "☠" : "⚠", attrs: { "aria-hidden": "true" } }),
        el("div", { className: "yas-review-row-body" }, [
          el("span", { className: "yas-review-row-source", textContent: row.sourceName }),
          el("span", { className: "yas-review-row-meta", textContent: meta }),
        ]),
      ]);
      button.addEventListener("click", () => select(row));
      rowElements.set(row.id, button);
      list.appendChild(button);
    }
  }

  function applyHighlight(): void {
    for (const [id, element] of rowElements) {
      const row = rowsById.get(id);
      element.classList.toggle("is-selected", id === selectedId);
      element.classList.toggle("is-current", row !== undefined && row.tick === position);
    }
  }

  function render(): void {
    for (const [value, button] of filterButtons) button.classList.toggle("is-active", state.filter === value);
    renderList(rows.filter(row => matchesFilter(row, state, sectionNameById)));
    applyHighlight();
    if (scrollOnNextRender && selectedId !== null) {
      rowElements.get(selectedId)?.scrollIntoView({ block: "nearest" });
      scrollOnNextRender = false;
    }
  }

  render();

  return {
    sections: sectionPicker?.element ?? null,
    setPosition(tick: number): void {
      if (tick === position) return;
      position = tick;
      applyHighlight();
    },
    dispose(): void {
      playerFilter.close();
      sectionPicker?.close();
      hudLayout.unregister("replayevents");
      panel.remove();
    },
  };
}

// A jump target rather than a persistent choice, so the trigger falls back to its prompt after
// each pick instead of showing the section you last visited.
function createSectionPicker(sections: MechanicSection[], controls: ReplayReviewControls): Dropdown {
  const picker = createDropdown({
    ariaLabel: "Jump to mechanic section",
    placeholder: "Jump to mechanic...",
    className: "yas-review-sections",
    options: sections.map((section, index) => ({
      value: String(index),
      label: `${ticksToLabel(Math.round(section.t * 60))}  ${section.name}`,
    })),
    onSelect: value => {
      picker.setValue("");
      const section = sections[Number(value)];
      if (!section) return;
      controls.pause();
      controls.seek(sectionSeekTick(section, controls.duration()));
    },
  });
  return picker;
}
