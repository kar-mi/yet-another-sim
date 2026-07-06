import { createElement } from "./dom";

const SEEN_KEY = "yas_seen_welcome";

const SECTIONS: { title: string; body: string }[] = [
  { title: "SETTINGS", body: "Click the ⚙ icon (top-right) to adjust camera, keybinds, controller, and display settings." },
  { title: "CUSTOMIZE THE UI", body: "In Settings → Display, set the UI scale/font, or click EDIT HUD LAYOUT to drag, resize, or hide HUD elements. You can also click the grid button." },
  { title: "LOADING A RAID", body: "Once in a session, use the RAID selector at the top of the screen to pick a raid, and the raid will auto start." },
  { title: "REPLAYS", body: "Every pull is recorded. Open REPLAYS in the lobby to rewatch and scrub through past pulls." },
];

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
    // localStorage unavailable (e.g. private browsing) — nothing to persist.
  }
}

/** Builds and shows the welcome overlay; can be reopened at any time from the About panel. */
export function showWelcomeModal(): void {
  if (document.getElementById("yas-welcome-modal")) return;

  const overlay = createElement("div");
  overlay.id = "yas-welcome-modal";

  const panel = createElement("div", "yas-raid-modal-panel yas-welcome-panel");
  panel.append(
    createElement("div", "yas-menu-title", "YET ANOTHER SIM"),
    createElement("div", "yas-menu-subtitle", "WELCOME"),
  );

  for (const section of SECTIONS) {
    const sectionEl = createElement("div", "yas-welcome-section");
    sectionEl.append(
      createElement("div", "yas-welcome-section-title", section.title),
      createElement("div", "yas-welcome-section-body", section.body),
    );
    panel.appendChild(sectionEl);
  }

  const closeBtn = createElement("button", "yas-menu-start", "GOT IT");
  closeBtn.type = "button";
  panel.appendChild(closeBtn);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const close = () => {
    markWelcomeSeen();
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  document.addEventListener("keydown", onKeydown);
}

/** Shows the welcome overlay only the first time a user ever reaches the lobby. */
export function maybeShowWelcomeModal(): void {
  if (!hasSeenWelcome()) showWelcomeModal();
}
