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
import { el } from "./dom";
import type { HudLayoutManager } from "./HudLayoutManager";

export type ReplayReviewControls = {
  duration: () => number;
  currentTick: () => number;
  pause: () => void;
  seek: (tick: number) => void;
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

  const playerSelect = el("select", { className: "yas-rng-select yas-review-player", ariaLabel: "Filter by party member" });
  playerSelect.appendChild(el("option", { value: "", textContent: "All party members" }));
  for (const player of insights.players) {
    playerSelect.appendChild(el("option", { value: player.id, textContent: player.label }));
  }
  playerSelect.addEventListener("change", () => { state.playerId = playerSelect.value; render(); });

  const list = el("div", { className: "yas-review-list", attrs: { role: "list" } });
  const panel = el("div", { id: "yas-replay-review" }, [
    el("span", { className: "yas-session-label", textContent: "EVENTS" }),
    search,
    filterRow,
    playerSelect,
    list,
  ]);
  document.body.appendChild(panel);
  hudLayout.register("replayevents", panel);

  const sectionsEl = insights.sections.length > 0 ? sectionPicker(insights.sections, controls) : null;

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
    sections: sectionsEl,
    setPosition(tick: number): void {
      if (tick === position) return;
      position = tick;
      applyHighlight();
    },
    dispose(): void {
      hudLayout.unregister("replayevents");
      panel.remove();
    },
  };
}

function sectionPicker(sections: MechanicSection[], controls: ReplayReviewControls): HTMLElement {
  const picker = el("select", {
    className: "yas-rng-select yas-review-sections",
    ariaLabel: "Jump to mechanic section",
  }, [el("option", { value: "", textContent: "Jump to mechanic..." })]);
  for (const [index, section] of sections.entries()) {
    picker.appendChild(el("option", {
      value: String(index),
      textContent: `${ticksToLabel(Math.round(section.t * 60))}  ${section.name}`,
    }));
  }
  picker.addEventListener("change", () => {
    const section = sections[Number(picker.value)];
    // Reset to the prompt so picking the same section twice still fires a change.
    picker.value = "";
    if (!section) return;
    controls.pause();
    controls.seek(sectionSeekTick(section, controls.duration()));
  });
  return picker;
}
