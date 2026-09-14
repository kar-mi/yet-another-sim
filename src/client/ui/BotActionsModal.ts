import type { NetClient } from "../net";
import { setGameplayInputSuppressed } from "../input";
import { el } from "./dom";

type BotActionsState = {
  isHost: boolean;
  botsInvincible: boolean;
  botsInvisible: boolean;
};

export type BotActionsModal = {
  button: HTMLButtonElement;
  dispose: () => void;
};

/** Host-only live bot switches. Unlike OPTIONS this never stops the pull — each switch applies at once. */
export function createBotActionsModal(net: NetClient, initial: BotActionsState): BotActionsModal {
  let state = initial;
  let previousFocus: HTMLElement | null = null;

  const button = el("button", {
    type: "button",
    className: "yas-bots-btn",
    textContent: "BOTS",
    title: "Bot actions",
    attrs: { "aria-haspopup": "dialog", "aria-expanded": "false" },
  });

  const invincibleInput = el("input", { type: "checkbox", className: "yas-switch", attrs: { role: "switch" } });
  const invisibleInput = el("input", { type: "checkbox", className: "yas-switch", attrs: { role: "switch" } });
  invincibleInput.addEventListener("change", () => {
    net.send({ type: "setBotsInvincible", enabled: invincibleInput.checked });
  });
  invisibleInput.addEventListener("change", () => {
    net.send({ type: "setBotsInvisible", enabled: invisibleInput.checked });
  });

  const modal = el("div", { id: "yas-rng-modal" });
  modal.style.display = "none";
  const panel = el("div", { className: "yas-raid-modal-panel yas-rng-panel", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Bot actions" } }, [
    el("div", { className: "yas-raid-modal-header" }, [
      el("div", { className: "yas-menu-subtitle", textContent: "BOT ACTIONS" }),
      el("button", { type: "button", className: "yas-rng-close", textContent: "CLOSE" }),
    ]),
    el("div", { className: "yas-rng-body" }, [
      el("div", { className: "yas-rng-note", textContent: "Applies immediately to every bot-controlled slot." }),
      el("label", { className: "yas-rng-row" }, [
        el("span", { textContent: "All bots invincible" }),
        invincibleInput,
      ]),
      el("label", { className: "yas-rng-row" }, [
        el("span", { textContent: "All bots invisible" }),
        invisibleInput,
      ]),
    ]),
  ]);
  modal.appendChild(panel);
  document.body.appendChild(modal);

  const isOpen = () => modal.style.display !== "none";

  const render = () => {
    button.disabled = !state.isHost;
    invincibleInput.checked = state.botsInvincible;
    invisibleInput.checked = state.botsInvisible;
  };

  const close = () => {
    if (!isOpen()) return;
    modal.style.display = "none";
    button.setAttribute("aria-expanded", "false");
    setGameplayInputSuppressed(false);
    previousFocus?.focus();
    previousFocus = null;
  };

  const open = () => {
    if (button.disabled || isOpen()) return;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    render();
    modal.style.display = "flex";
    button.setAttribute("aria-expanded", "true");
    setGameplayInputSuppressed(true);
    invincibleInput.focus();
  };

  button.addEventListener("click", open);
  panel.querySelector<HTMLButtonElement>(".yas-rng-close")!.addEventListener("click", close);
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);

  const disposeLobby = net.on("lobby", message => {
    state = {
      isHost: net.clientId === message.hostClientId,
      botsInvincible: message.botsInvincible,
      botsInvisible: message.botsInvisible,
    };
    if (!state.isHost) close();
    render();
  });
  const disposePlayback = net.on("playback", message => {
    state = { ...state, isHost: net.clientId === message.hostClientId };
    if (!state.isHost) close();
    render();
  });
  render();

  return {
    button,
    dispose: () => {
      close();
      disposeLobby();
      disposePlayback();
      document.removeEventListener("keydown", onKeydown);
      modal.remove();
    },
  };
}
