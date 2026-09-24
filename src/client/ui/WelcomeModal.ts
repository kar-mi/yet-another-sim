import { setGameplayInputSuppressed } from "../input";
import { createElement, el } from "./dom";
import type { HudLayoutManager } from "./HudLayoutManager";
import { buildTourSteps, RAID_SELECTOR_TARGET, type TourStep } from "./guidedTourModel";

const SEEN_KEY = "yas_seen_welcome";
const REPOSITION_MS = 250;
const HALO_PAD = 8;
const CARD_GAP = 14;

export interface SimulatorTourContext {
  isHost: boolean;
  hasReplayButton: boolean;
  hudLayout: HudLayoutManager;
}

let simulatorContext: SimulatorTourContext | null = null;
let active: { dispose: () => void } | null = null;
let deferredStart = false;

function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markWelcomeSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
  }
}

export function setSimulatorTourContext(context: SimulatorTourContext | null): void {
  simulatorContext = context;
  if (!context) active?.dispose();
}

export function showWelcomeModal(): void {
  if (active) return;
  const context = simulatorContext;
  const steps = buildTourSteps({
    inSimulator: context !== null,
    isHost: context?.isHost ?? false,
    hasReplayButton: context?.hasReplayButton ?? false,
  });
  active = startTour(steps, context);
}

export function maybeShowWelcomeModal(): void {
  if (!hasSeenWelcome() || deferredStart) {
    deferredStart = false;
    showWelcomeModal();
  }
}

function focusable(root: HTMLElement): HTMLElement[] {
  const selector = "button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])";
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(node => !node.hasAttribute("disabled"));
}

function startTour(steps: TourStep[], context: SimulatorTourContext | null): { dispose: () => void } {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const inSimulator = context !== null;
  let index = 0;
  let revealedSelector = false;

  const blocker = createElement("div", "yas-tour-blocker");
  const halo = createElement("div", "yas-tour-halo");
  const card = el("div", {
    className: "yas-tour-card",
    attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Getting started", tabindex: "-1" },
  });
  const root = el("div", { id: "yas-tour" }, [blocker, halo, card]);
  document.body.appendChild(root);
  setGameplayInputSuppressed(true);

  const setSelectorRevealed = (revealed: boolean) => {
    if (revealed === revealedSelector || !context) return;
    revealedSelector = revealed;
    context.hudLayout.setGroupRevealed("raidselector", revealed);
  };

  const layout = () => {
    const scale = Number(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
    const viewW = innerWidth / scale;
    const viewH = innerHeight / scale;
    card.style.maxWidth = `${viewW - 24}px`;
    card.style.maxHeight = `${viewH - 24}px`;
    const cardBox = card.getBoundingClientRect();
    const cardW = cardBox.width / scale;
    const cardH = cardBox.height / scale;

    const step = steps[index];
    const target = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    const box = target?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) {
      halo.style.display = "none";
      blocker.classList.add("is-dim");
      card.style.left = `${Math.max(0, (viewW - cardW) / 2)}px`;
      card.style.top = `${Math.max(0, (viewH - cardH) / 2)}px`;
      return;
    }
    const left = box.left / scale;
    const top = box.top / scale;
    const width = box.width / scale;
    const height = box.height / scale;

    halo.style.display = "";
    blocker.classList.remove("is-dim");
    Object.assign(halo.style, {
      left: `${left - HALO_PAD}px`,
      top: `${top - HALO_PAD}px`,
      width: `${width + HALO_PAD * 2}px`,
      height: `${height + HALO_PAD * 2}px`,
    });

    const below = top + height + CARD_GAP;
    const above = top - CARD_GAP - cardH;
    const leftOf = left - CARD_GAP - cardW;
    let x = left + width / 2 - cardW / 2;
    let y: number;
    if (below + cardH <= viewH) {
      y = below;
    } else if (above >= 0) {
      y = above;
    } else {
      y = top + height / 2 - cardH / 2;
      x = leftOf >= 0 ? leftOf : left + width + CARD_GAP;
    }
    card.style.left = `${Math.max(8, Math.min(x, viewW - cardW - 8))}px`;
    card.style.top = `${Math.max(8, Math.min(y, viewH - cardH - 8))}px`;
  };

  const render = () => {
    const step = steps[index];
    setSelectorRevealed(step.target === RAID_SELECTOR_TARGET);

    const closeBtn = createElement("button", "yas-tour-close", "×");
    closeBtn.type = "button";
    closeBtn.ariaLabel = "Close tour";
    closeBtn.addEventListener("click", exit);

    const body = createElement("div", "yas-tour-body");
    if (step.sections) {
      body.append(
        createElement("div", "yas-menu-title", "YET ANOTHER SIM"),
        createElement("div", "yas-menu-subtitle", step.title),
      );
      for (const section of step.sections) {
        const sectionEl = createElement("div", "yas-welcome-section");
        sectionEl.append(
          createElement("div", "yas-welcome-section-title", section.title),
          createElement("div", "yas-welcome-section-body", section.body),
        );
        body.appendChild(sectionEl);
      }
    } else {
      body.append(
        createElement("div", "yas-tour-step-title", step.title),
        createElement("div", "yas-welcome-section-body", step.body ?? ""),
      );
    }
    if (step.footnote) body.appendChild(createElement("div", "yas-tour-footnote", step.footnote));

    const isLast = index === steps.length - 1;
    const nextBtn = createElement("button", "yas-menu-start", isLast && inSimulator ? "DONE" : "NEXT");
    nextBtn.type = "button";
    nextBtn.addEventListener("click", () => {
      if (!isLast) {
        index += 1;
        render();
        return;
      }
      if (!inSimulator) deferredStart = true;
      exit();
    });

    const footer = createElement("div", "yas-tour-footer");
    if (steps.length > 1) footer.appendChild(createElement("span", "yas-tour-progress", `${index + 1} / ${steps.length}`));
    footer.appendChild(nextBtn);

    card.replaceChildren(closeBtn, body, footer);
    layout();
    nextBtn.focus();
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      exit();
      return;
    }
    if (event.key === "Tab") {
      const items = focusable(card);
      if (items.length > 0) {
        const first = items[0];
        const last = items[items.length - 1];
        const current = document.activeElement;
        if (event.shiftKey && (current === first || !card.contains(current))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (current === last || !card.contains(current))) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    event.stopPropagation();
  };
  const swallow = (event: Event) => event.stopPropagation();

  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("keyup", swallow, true);
  window.addEventListener("resize", layout);
  const timer = window.setInterval(layout, REPOSITION_MS);

  function exit(): void {
    markWelcomeSeen();
    dispose();
  }

  function dispose(): void {
    if (active !== handle) return;
    active = null;
    window.clearInterval(timer);
    window.removeEventListener("resize", layout);
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("keyup", swallow, true);
    setSelectorRevealed(false);
    setGameplayInputSuppressed(false);
    root.remove();
    previousFocus?.focus();
  }

  const handle = { dispose };
  active = handle;
  render();
  return handle;
}
