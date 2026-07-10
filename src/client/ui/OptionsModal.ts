import type { BotPatternOption, DecisionDescription } from "@shared/protocol";
import { WAYMARK_PRESETS } from "@shared/waymarkPresets";
import { clearRngConstraints, loadRngConstraints, saveRngConstraints } from "../rngPrefs";
import { clearWaymarkPreset, loadWaymarkPreset, saveWaymarkPreset } from "../waymarkPrefs";
import type { NetClient } from "../net";
import { el } from "./dom";

type OptionsModalState = {
  raidId: string;
  currentSeed: number | null;
  seedOverride: number | null;
  rngDecisions: DecisionDescription[];
  waymarkPresetId: string | null;
  botPatternOptions: BotPatternOption[];
  botPatternId: string | null;
  isHost: boolean;
};

type OptionsTab = "waymark" | "bots" | "rng";

function formatSeed(seed: number | null): string {
  return seed === null ? "-" : `0x${seed.toString(16).padStart(8, "0")}`;
}

export function armSeed(net: NetClient, raidId: string): void {
  const constraints = loadRngConstraints(raidId);
  if (Object.keys(constraints).length === 0) return;
  net.send({ type: "findSeed", constraints });
}

export function armWaymark(net: NetClient, raidId: string): void {
  const presetId = loadWaymarkPreset(raidId);
  if (presetId === null) return;
  net.send({ type: "setWaymarkPreset", presetId });
}

export function createOptionsModal(net: NetClient, initial: OptionsModalState): {
  open: () => void;
  update: (next: Partial<OptionsModalState>) => void;
  dispose: () => void;
} {
  let state = initial;
  let selects: HTMLSelectElement[] = [];
  let dirty = false;

  const modal = el("div", { id: "yas-rng-modal" });
  modal.style.display = "none";

  // --- Waymark tab ---
  const waymarkSelect = el("select", { className: "yas-rng-select" }, [
    el("option", { value: "", textContent: "Default" }),
    ...WAYMARK_PRESETS.map(preset => el("option", { value: preset.id, textContent: preset.name })),
  ]);
  waymarkSelect.addEventListener("change", () => {
    const presetId = waymarkSelect.value || null;
    if (presetId) saveWaymarkPreset(state.raidId, presetId);
    else clearWaymarkPreset(state.raidId);
    net.send({ type: "setWaymarkPreset", presetId });
  });
  const waymarkBody = el("div", { className: "yas-rng-body" }, [
    el("div", { className: "yas-rng-note", textContent: "Ground marker layout for this pull." }),
    el("label", { className: "yas-rng-row" }, [
      el("span", { textContent: "Waymark preset" }),
      waymarkSelect,
    ]),
  ]);

  // --- Bots tab ---
  const botsSelect = el("select", { className: "yas-rng-select" });
  const botsNote = el("div", { className: "yas-rng-note" });
  botsSelect.addEventListener("change", () => {
    net.send({ type: "setBotPattern", patternId: botsSelect.value });
  });
  const botsBody = el("div", { className: "yas-rng-body" }, [
    botsNote,
    el("label", { className: "yas-rng-row" }, [
      el("span", { textContent: "Bot pattern" }),
      botsSelect,
    ]),
  ]);

  // --- RNG tab (unchanged behavior) ---
  const currentSeed = el("span", { className: "yas-rng-seed", textContent: formatSeed(state.currentSeed) });
  const overrideText = el("div", { className: "yas-rng-note" });
  const errorText = el("div", { className: "yas-rng-error" });
  const decisionList = el("div", { className: "yas-rng-decisions" });

  const renderHeader = () => {
    currentSeed.textContent = formatSeed(state.currentSeed);
    overrideText.textContent = state.seedOverride === null
      ? "Random seed each pull."
      : "Selected outcomes applied every pull.";
  };

  const renderDecisions = () => {
    renderHeader();
    selects = [];
    decisionList.replaceChildren();
    if (state.rngDecisions.length === 0) {
      decisionList.appendChild(el("div", { className: "yas-rng-note", textContent: "No pre-pull RNG choices for this raid." }));
      return;
    }
    const saved = loadRngConstraints(state.raidId);
    for (const desc of state.rngDecisions) {
      const select = el("select", { className: "yas-rng-select", attrs: { "data-key": desc.key } }, [
        el("option", { value: "", textContent: "Any" }),
        ...desc.options.map((option, i) => el("option", { value: String(i), textContent: option })),
      ]);
      const savedValue = saved[desc.key];
      if (Number.isInteger(savedValue) && savedValue >= 0 && savedValue < desc.options.length) {
        select.value = String(savedValue);
      }
      select.addEventListener("change", () => {
        dirty = true;
        errorText.textContent = "";
      });
      selects.push(select);
      decisionList.appendChild(el("label", { className: "yas-rng-row" }, [
        el("span", { textContent: desc.label }),
        select,
      ]));
    }
  };

  const applySelection = () => {
    const constraints: Record<string, number> = {};
    for (const select of selects) {
      if (select.value !== "") constraints[select.dataset.key!] = Number(select.value);
    }
    if (Object.keys(constraints).length === 0) {
      clearRngConstraints(state.raidId);
      errorText.textContent = "";
      net.send({ type: "setSeed", seed: null });
      return;
    }
    saveRngConstraints(state.raidId, constraints);
    errorText.textContent = "";
    net.send({ type: "findSeed", constraints });
  };

  const rngBody = el("div", { className: "yas-rng-body" }, [
    el("div", { className: "yas-rng-current" }, [
      el("span", { textContent: "Current pull seed" }),
      currentSeed,
    ]),
    overrideText,
    decisionList,
    el("div", { className: "yas-rng-actions" }, [
      el("button", { type: "button", className: "yas-rng-random", textContent: "RESET" }),
    ]),
    errorText,
  ]);

  const close = () => {
    if (modal.style.display === "none") return;
    if (dirty) {
      dirty = false;
      applySelection();
    }
    modal.style.display = "none";
  };

  // --- Tab strip ---
  const tabs: { id: OptionsTab; label: string; body: HTMLElement }[] = [
    { id: "waymark", label: "WAYMARK", body: waymarkBody },
    { id: "bots", label: "BOTS", body: botsBody },
    { id: "rng", label: "RNG", body: rngBody },
  ];
  const tabButtons = tabs.map(tab => el("button", { type: "button", className: "yas-options-tab", textContent: tab.label }));
  const setActiveTab = (tab: OptionsTab) => {
    tabs.forEach((t, i) => {
      tabButtons[i].classList.toggle("is-active", t.id === tab);
      t.body.style.display = t.id === tab ? "" : "none";
    });
  };
  tabs.forEach((tab, i) => tabButtons[i].addEventListener("click", () => setActiveTab(tab.id)));
  const tabStrip = el("div", { className: "yas-options-tabs" }, tabButtons);

  const panel = el("div", { className: "yas-raid-modal-panel yas-rng-panel" }, [
    el("div", { className: "yas-raid-modal-header" }, [
      el("div", { className: "yas-menu-subtitle", textContent: "OPTIONS" }),
      el("button", { type: "button", className: "yas-rng-close", textContent: "CLOSE" }),
    ]),
    tabStrip,
    waymarkBody,
    botsBody,
    rngBody,
  ]);
  modal.appendChild(panel);
  setActiveTab("waymark");

  panel.querySelector<HTMLButtonElement>(".yas-rng-close")!.addEventListener("click", close);
  panel.querySelector<HTMLButtonElement>(".yas-rng-random")!.addEventListener("click", () => {
    dirty = false;
    errorText.textContent = "";
    clearRngConstraints(state.raidId);
    for (const select of selects) select.value = "";
    net.send({ type: "setSeed", seed: null });
  });
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && modal.style.display !== "none") close();
  };
  const disposeRngResult = net.on("rngResult", message => {
    errorText.textContent = message.ok ? "" : "No seed found within search cap.";
  });
  document.addEventListener("keydown", onKeydown);
  document.body.appendChild(modal);

  const renderWaymark = () => {
    waymarkSelect.value = state.waymarkPresetId ?? "";
  };

  const renderBots = () => {
    botsSelect.replaceChildren(...state.botPatternOptions.map(option => el("option", { value: option.id, textContent: option.name })));
    const hasChoice = state.botPatternOptions.length > 1;
    botsSelect.disabled = !hasChoice;
    botsNote.textContent = state.botPatternOptions.length === 0
      ? "This raid has no bot-controlled movement."
      : hasChoice ? "" : "No alternate patterns for this raid.";
    if (state.botPatternId !== null) botsSelect.value = state.botPatternId;
  };

  return {
    open: () => {
      if (!state.isHost) return;
      errorText.textContent = "";
      renderWaymark();
      renderBots();
      renderDecisions();
      modal.style.display = "flex";
      tabButtons[0]?.focus();
    },
    update: next => {
      state = { ...state, ...next };
      if (modal.style.display !== "none") {
        renderWaymark();
        renderBots();
        if (dirty) renderHeader();
        else renderDecisions();
      }
    },
    dispose: () => {
      disposeRngResult();
      document.removeEventListener("keydown", onKeydown);
      modal.remove();
    },
  };
}
