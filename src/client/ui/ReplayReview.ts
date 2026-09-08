// Replay review UI: the event sidebar, the death markers beneath the seek bar, and the section
// navigator, over the insights collected in client/replayInsights.ts.
//
// The sidebar and the markers share one filter state; the section navigator is independent of it,
// so sections locate you in the fight whether or not anything happened to the filtered player.

import type { MechanicSection } from "@shared/types";
import type { ReplayInsights } from "@shared/replay";
import {
  buildRows, damageLabel, eventSeekTick, groupDeathMarkers, matchesFilter, rowLabel,
  sectionSeekTick, ticksToLabel,
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
  // Appended under the seek bar by the raid HUD. `sections` is null when the recording has none.
  markers: HTMLElement;
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

  // Shares the seek bar's width so each marker lines up with the position it points at.
  const markers = el("div", { className: "yas-review-markers", attrs: { role: "group", "aria-label": "Death markers" } });

  let sectionsEl: HTMLElement | null = null;
  if (insights.sections.length > 0) {
    sectionsEl = el("div", { className: "yas-review-sections", attrs: { role: "group", "aria-label": "Mechanic sections" } });
    for (const section of insights.sections) sectionsEl.appendChild(sectionButton(section, controls));
  }

  const rowElements = new Map<string, HTMLElement>();

  function emptyMessage(visible: ReviewRow[]): string | null {
    if (!insights.available) return "Event details were not recorded for this replay.";
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

  function renderMarkers(visible: ReviewRow[]): void {
    markers.replaceChildren();
    const duration = Math.max(1, controls.duration());
    for (const group of groupDeathMarkers(visible)) {
      const names = group.rows.map(row => row.playerLabel).join(", ");
      const grouped = group.rows.length > 1;
      const marker = el("button", {
        type: "button",
        className: `yas-review-marker${grouped ? " is-group" : ""}`
          + `${group.rows.some(row => row.id === selectedId) ? " is-active" : ""}`,
        textContent: grouped ? String(group.rows.length) : "",
        attrs: {
          "aria-label": grouped
            ? `${group.rows.length} deaths at ${ticksToLabel(group.tick)}: ${names}`
            : `Death at ${ticksToLabel(group.tick)}: ${names} — ${group.rows[0]!.sourceName}`,
          title: `${ticksToLabel(group.tick)} — ${names}`,
        },
      });
      marker.style.left = `${(group.tick / duration) * 100}%`;
      if (!grouped) {
        marker.addEventListener("click", () => select(group.rows[0]!));
      } else {
        // A grouped marker opens a small list so every simultaneous death stays reachable.
        const popup = el("div", { className: "yas-review-marker-popup", hidden: true });
        for (const row of group.rows) {
          const entry = el("button", {
            type: "button",
            className: "yas-review-marker-entry",
            textContent: `${row.playerLabel} — ${row.sourceName}`,
          });
          entry.addEventListener("click", () => { popup.hidden = true; select(row); });
          popup.appendChild(entry);
        }
        marker.addEventListener("click", () => { popup.hidden = !popup.hidden; });
        marker.appendChild(popup);
      }
      markers.appendChild(marker);
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
    const visible = rows.filter(row => matchesFilter(row, state, sectionNameById));
    renderList(visible);
    renderMarkers(visible);
    applyHighlight();
    if (scrollOnNextRender && selectedId !== null) {
      rowElements.get(selectedId)?.scrollIntoView({ block: "nearest" });
      scrollOnNextRender = false;
    }
  }

  render();

  return {
    markers,
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

function sectionButton(section: MechanicSection, controls: ReplayReviewControls): HTMLElement {
  const button = el("button", {
    type: "button",
    className: "yas-review-section",
    textContent: section.name,
    attrs: {
      "aria-label": `Jump to ${section.name} at ${ticksToLabel(Math.round(section.t * 60))}`,
      title: ticksToLabel(Math.round(section.t * 60)),
    },
  });
  button.addEventListener("click", () => {
    controls.pause();
    controls.seek(sectionSeekTick(section, controls.duration()));
  });
  return button;
}
