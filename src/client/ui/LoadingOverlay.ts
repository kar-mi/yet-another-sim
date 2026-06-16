import { el } from "./dom";

let overlay: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function ensureOverlay(): HTMLElement {
  if (overlay) return overlay;
  overlay = el("div", { id: "yas-loading" }, [
    el("div", { className: "yas-loading-spinner" }),
    el("div", { className: "yas-loading-label", textContent: "LOADING" }),
  ]);
  overlay.style.display = "none";
  document.body.appendChild(overlay);
  return overlay;
}

// Cover the screen with a brief loading overlay. Used on raid change as a deliberate transition so the
// floor/asset swap reads as an intentional load rather than a pop. Re-calling restarts the timer.
export function showLoadingOverlay(durationMs = 600): void {
  const node = ensureOverlay();
  node.style.display = "flex";
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    node.style.display = "none";
    hideTimer = null;
  }, durationMs);
}
