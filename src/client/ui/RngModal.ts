import { EMPTY_RAID_ID } from "@shared/protocol";
import { describeDecisions, findSeed } from "../../engine/seedSearch";
import { loadRaid } from "../../engine/raidLoader";
import type { RaidDef } from "../../engine/raidSchema";
import { clearRngConstraints, loadRngConstraints, saveRngConstraints } from "../rngPrefs";
import type { NetClient } from "../net";
import { RAID_DEFS } from "../staticRaids.generated";
import { el } from "./dom";

type RngModalState = {
  raidId: string;
  currentSeed: number | null;
  seedOverride: number | null;
  isHost: boolean;
};

function formatSeed(seed: number | null): string {
  return seed === null ? "-" : `0x${seed.toString(16).padStart(8, "0")}`;
}

function raidFor(raidId: string): RaidDef | null {
  if (raidId === EMPTY_RAID_ID) return null;
  const definition = RAID_DEFS[raidId];
  return definition ? loadRaid(definition.raid) : null;
}

export function armSeed(net: NetClient, raidId: string): void {
  const constraints = loadRngConstraints(raidId);
  if (Object.keys(constraints).length === 0) return;
  const raid = raidFor(raidId);
  if (!raid) return;
  const seed = findSeed(raid, constraints);
  if (seed !== null) net.send({ type: "setSeed", seed });
}

export function createRngModal(net: NetClient, initial: RngModalState): {
  open: () => void;
  update: (next: Partial<RngModalState>) => void;
  dispose: () => void;
} {
  let state = initial;
  let selects: HTMLSelectElement[] = [];

  const modal = el("div", { id: "yas-rng-modal" });
  modal.style.display = "none";
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
    const raid = raidFor(state.raidId);
    const descriptions = raid ? describeDecisions(raid) : [];
    if (descriptions.length === 0) {
      decisionList.appendChild(el("div", { className: "yas-rng-note", textContent: "No pre-pull RNG choices for this raid." }));
      return;
    }
    const saved = loadRngConstraints(state.raidId);
    for (const desc of descriptions) {
      const select = el("select", { className: "yas-rng-select", attrs: { "data-key": desc.key } }, [
        el("option", { value: "", textContent: "Any" }),
        ...desc.options.map((option, i) => el("option", { value: String(i), textContent: option })),
      ]);
      const savedValue = saved[desc.key];
      if (Number.isInteger(savedValue) && savedValue >= 0 && savedValue < desc.options.length) {
        select.value = String(savedValue);
      }
      selects.push(select);
      decisionList.appendChild(el("label", { className: "yas-rng-row" }, [
        el("span", { textContent: desc.label }),
        select,
      ]));
    }
  };

  const close = () => {
    modal.style.display = "none";
  };

  const findMatchingSeed = () => {
    const raid = raidFor(state.raidId);
    if (!raid) return;
    const constraints: Record<string, number> = {};
    for (const select of selects) {
      if (select.value !== "") constraints[select.dataset.key!] = Number(select.value);
    }
    if (Object.keys(constraints).length === 0) {
      errorText.textContent = "Pick at least one outcome.";
      return;
    }
    saveRngConstraints(state.raidId, constraints);
    const seed = findSeed(raid, constraints);
    if (seed === null) {
      errorText.textContent = "No seed found within search cap.";
      return;
    }
    errorText.textContent = "";
    net.send({ type: "setSeed", seed });
  };

  const panel = el("div", { className: "yas-raid-modal-panel yas-rng-panel" }, [
    el("div", { className: "yas-raid-modal-header" }, [
      el("div", { className: "yas-menu-subtitle", textContent: "RNG" }),
      el("button", { type: "button", className: "yas-rng-close", textContent: "CLOSE" }),
    ]),
    el("div", { className: "yas-rng-body" }, [
      el("div", { className: "yas-rng-current" }, [
        el("span", { textContent: "Current pull seed" }),
        currentSeed,
      ]),
      overrideText,
      decisionList,
      el("div", { className: "yas-rng-actions" }, [
        el("button", { type: "button", className: "yas-rng-find", textContent: "APPLY OPTIONS" }),
        el("button", { type: "button", className: "yas-rng-random", textContent: "RANDOM" }),
      ]),
      errorText,
    ]),
  ]);
  modal.appendChild(panel);

  panel.querySelector<HTMLButtonElement>(".yas-rng-close")!.addEventListener("click", close);
  panel.querySelector<HTMLButtonElement>(".yas-rng-random")!.addEventListener("click", () => {
    errorText.textContent = "";
    clearRngConstraints(state.raidId);
    for (const select of selects) select.value = "";
    net.send({ type: "setSeed", seed: null });
  });
  panel.querySelector<HTMLButtonElement>(".yas-rng-find")!.addEventListener("click", findMatchingSeed);
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && modal.style.display !== "none") close();
  };
  document.addEventListener("keydown", onKeydown);
  document.body.appendChild(modal);

  return {
    open: () => {
      if (!state.isHost) return;
      errorText.textContent = "";
      renderDecisions();
      modal.style.display = "flex";
      selects[0]?.focus();
    },
    update: next => {
      state = { ...state, ...next };
      if (modal.style.display !== "none") renderDecisions();
    },
    dispose: () => {
      document.removeEventListener("keydown", onKeydown);
      modal.remove();
    },
  };
}
