import type { World, Player } from "../../shared/types";
import { triggerAction, toggleInvincibility } from "../input";
import { SPRINT_COOLDOWN, ANTI_KB_COOLDOWN, PROVOKE_COOLDOWN } from "../../engine/sim";
import {
  ACTIONS,
  CONTROLLER_BUTTON_LABELS,
  CONTROLLER_FACE_SLOTS,
  CONTROLLER_MODIFIED_SLOTS,
  KEYBOARD_HOTBAR_SLOT_COUNT,
  actionForKeyboardSlot,
  type ControllerSlotMeta,
} from "../actions";
import { keyLabel } from "../settings";
import type { Settings, ControllerType } from "../settings";
import { clamp01 } from "../../shared/math";

// Map a status effect to a compact icon glyph (replaces the old text name). A plant arrow is
// rotated to match the knockback heading ("➤" points east by default; screen +z is up).
function effectIcon(effect: Player["effects"][number]): { glyph: string; rotate?: number } {
  switch (effect.behavior.kind) {
    case "plant": {
      const [x, z] = effect.behavior.direction;
      return { glyph: "➤", rotate: (Math.atan2(-z, x) * 180) / Math.PI };
    }
    case "sleep": return { glyph: "💤" };
    case "confusion": return { glyph: "❓" };
    case "vuln": return { glyph: "▼" };
    case "pyretic": return { glyph: "🔥" };
    case "freeze": return { glyph: "❄" };
    default: return { glyph: effect.kind === "buff" ? "▲" : "●" };
  }
}

function activeVisibleEffects(player: Player, time: number): Player["effects"] {
  return player.effects
    .filter(e => e.visibility !== "invisible" && e.appliedAt + e.duration > time)
    .map((effect, index) => ({ effect, index }))
    .sort((a, b) => {
      const aPlant = a.effect.behavior.kind === "plant";
      const bPlant = b.effect.behavior.kind === "plant";
      if (aPlant && bPlant) return (a.effect.plantSlot ?? a.index) - (b.effect.plantSlot ?? b.index);
      return a.index - b.index;
    })
    .map(entry => entry.effect);
}

function buildEffectChip(effect: Player["effects"][number], time: number, className: string): HTMLSpanElement {
  const effectEl = document.createElement("span");
  effectEl.className = `${className} ${className}-${effect.kind}`;
  effectEl.title = effect.name;
  const icon = effectIcon(effect);
  const iconEl = document.createElement("span");
  iconEl.className = `${className}-icon`;
  iconEl.textContent = icon.glyph;
  if (icon.rotate !== undefined) iconEl.style.transform = `rotate(${icon.rotate}deg)`;
  const timerEl = document.createElement("span");
  timerEl.className = `${className}-timer`;
  timerEl.textContent = `${Math.ceil(effect.appliedAt + effect.duration - time)}s`;
  effectEl.append(iconEl, timerEl);
  return effectEl;
}

export class HudOverlay {
  private root: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private mpFill: HTMLDivElement;
  private hpVal: HTMLSpanElement;
  private mpVal: HTMLSpanElement;
  private invulnBtn: HTMLButtonElement;
  private sprintSlot: HTMLDivElement;
  private sprintKeybind: HTMLSpanElement;
  private sprintCdOverlay: HTMLDivElement;
  private sprintCdText: HTMLDivElement;
  private prevSprintCooldown = 0;
  private antiKbSlot: HTMLDivElement;
  private antiKbCdOverlay: HTMLDivElement;
  private antiKbCdText: HTMLDivElement;
  private prevAntiKbCooldown = 0;
  private ctrlAntiKbSlot!: HTMLDivElement;
  private ctrlAntiKbCdOverlay!: HTMLDivElement;
  private ctrlAntiKbCdText!: HTMLDivElement;
  private provokeSlot: HTMLDivElement;
  private provokeCdOverlay: HTMLDivElement;
  private provokeCdText: HTMLDivElement;
  private prevProvokeCooldown = 0;
  private ctrlProvokeSlot!: HTMLDivElement;
  private ctrlProvokeCdOverlay!: HTMLDivElement;
  private ctrlProvokeCdText!: HTMLDivElement;
  private sessionEl: HTMLDivElement;
  private partyEl!: HTMLDivElement;
  private partyRows = new Map<string, { hpFill: HTMLDivElement; mpFill: HTMLDivElement; rowEl: HTMLDivElement; effectsEl: HTMLDivElement; camBtn?: HTMLButtonElement }>();
  private castBarEl!: HTMLDivElement;
  private castNameEl!: HTMLDivElement;
  private castFillEl!: HTMLDivElement;
  private castTimerEl!: HTMLDivElement;
  private slotKeybinds: HTMLSpanElement[] = [];
  private modeToggleBtn!: HTMLButtonElement;
  private currentSettings!: Settings;
  private debuffTrackerEl!: HTMLDivElement;
  private kbmHotbar!: HTMLDivElement;
  private controllerHotbar!: HTMLDivElement;
  private ctrlSprintSlot!: HTMLDivElement;
  private ctrlSprintCdOverlay!: HTMLDivElement;
  private ctrlSprintCdText!: HTMLDivElement;

  constructor(
    sessionId: string,
    private readonly localPlayerId: string | null = null,
    private onSettingsChange: (settings: Settings) => void = () => {},
    private onSpectate: (id: string) => void = () => {},
  ) {
    this.root = this.buildHud();
    document.body.appendChild(this.root);

    this.hpFill = this.root.querySelector<HTMLDivElement>(".yas-hp-fill")!;
    this.mpFill = this.root.querySelector<HTMLDivElement>(".yas-mp-fill")!;
    this.hpVal = this.root.querySelector<HTMLSpanElement>("[data-hp-val]")!;
    this.mpVal = this.root.querySelector<HTMLSpanElement>("[data-mp-val]")!;
    this.invulnBtn = this.root.querySelector<HTMLButtonElement>(".yas-invuln-btn")!;
    this.sprintSlot = this.root.querySelector<HTMLDivElement>(`[data-slot='${ACTIONS.sprint.keyboardSlot}']`)!;
    this.sprintKeybind = this.sprintSlot.querySelector<HTMLSpanElement>(".yas-keybind")!;
    this.sprintCdOverlay = this.sprintSlot.querySelector<HTMLDivElement>(".yas-cd-overlay")!;
    this.sprintCdText = this.sprintSlot.querySelector<HTMLDivElement>(".yas-cd-text")!;
    this.antiKbSlot = this.root.querySelector<HTMLDivElement>(`[data-slot='${ACTIONS.antiKnockback.keyboardSlot}']`)!;
    this.antiKbCdOverlay = this.antiKbSlot.querySelector<HTMLDivElement>(".yas-cd-overlay")!;
    this.antiKbCdText = this.antiKbSlot.querySelector<HTMLDivElement>(".yas-cd-text")!;
    this.provokeSlot = this.root.querySelector<HTMLDivElement>(`[data-slot='${ACTIONS.provoke.keyboardSlot}']`)!;
    this.provokeCdOverlay = this.provokeSlot.querySelector<HTMLDivElement>(".yas-cd-overlay")!;
    this.provokeCdText = this.provokeSlot.querySelector<HTMLDivElement>(".yas-cd-text")!;
    this.debuffTrackerEl = this.root.querySelector<HTMLDivElement>(".yas-debuff-tracker")!;
    this.kbmHotbar = this.root.querySelector<HTMLDivElement>(".yas-hotbar")!;
    this.controllerHotbar = this.root.querySelector<HTMLDivElement>(".yas-controller-hotbar")!;
    this.slotKeybinds = Array.from(this.kbmHotbar.querySelectorAll<HTMLSpanElement>(".yas-keybind"));
    this.modeToggleBtn = this.root.querySelector<HTMLButtonElement>(".yas-hotbar-toggle")!;
    this.ctrlSprintSlot = this.controllerHotbar.querySelector<HTMLDivElement>(`[data-ctrl-slot='${ACTIONS.sprint.controllerSlot}']`)!;
    this.ctrlSprintCdOverlay = this.ctrlSprintSlot.querySelector<HTMLDivElement>(".yas-cd-overlay")!;
    this.ctrlSprintCdText = this.ctrlSprintSlot.querySelector<HTMLDivElement>(".yas-cd-text")!;
    this.ctrlAntiKbSlot = this.controllerHotbar.querySelector<HTMLDivElement>(`[data-ctrl-slot='${ACTIONS.antiKnockback.controllerSlot}']`)!;
    this.ctrlAntiKbCdOverlay = this.ctrlAntiKbSlot.querySelector<HTMLDivElement>(".yas-cd-overlay")!;
    this.ctrlAntiKbCdText = this.ctrlAntiKbSlot.querySelector<HTMLDivElement>(".yas-cd-text")!;
    this.ctrlProvokeSlot = this.controllerHotbar.querySelector<HTMLDivElement>(`[data-ctrl-slot='${ACTIONS.provoke.controllerSlot}']`)!;
    this.ctrlProvokeCdOverlay = this.ctrlProvokeSlot.querySelector<HTMLDivElement>(".yas-cd-overlay")!;
    this.ctrlProvokeCdText = this.ctrlProvokeSlot.querySelector<HTMLDivElement>(".yas-cd-text")!;

    this.statusEl = document.createElement("div");
    this.statusEl.id = "yas-status";
    document.body.appendChild(this.statusEl);

    this.sessionEl = document.createElement("div");
    this.sessionEl.id = "yas-session-id";
    const sessionLabel = document.createElement("span");
    sessionLabel.className = "yas-session-label";
    sessionLabel.textContent = "SESSION";
    const sessionVal = document.createElement("span");
    sessionVal.className = "yas-session-val";
    sessionVal.textContent = sessionId;
    this.sessionEl.append(sessionLabel, sessionVal);
    document.body.appendChild(this.sessionEl);

    this.partyEl = document.createElement("div");
    this.partyEl.id = "yas-party";
    document.body.appendChild(this.partyEl);

    this.castBarEl = document.createElement("div");
    this.castBarEl.id = "yas-cast-bar";
    this.castBarEl.style.display = "none";
    this.castNameEl = document.createElement("div");
    this.castNameEl.className = "yas-cast-name";
    const castTrack = document.createElement("div");
    castTrack.className = "yas-cast-track";
    this.castFillEl = document.createElement("div");
    this.castFillEl.className = "yas-cast-fill";
    this.castTimerEl = document.createElement("div");
    this.castTimerEl.className = "yas-cast-timer";
    castTrack.appendChild(this.castFillEl);
    this.castBarEl.append(this.castNameEl, castTrack, this.castTimerEl);
    document.body.appendChild(this.castBarEl);

    this.bindEvents();
  }

  private buildHud(): HTMLDivElement {
    const template = document.querySelector<HTMLTemplateElement>("#yas-hud-template")!;
    const root = template.content.firstElementChild!.cloneNode(true) as HTMLDivElement;

    root.querySelector<HTMLDivElement>(".yas-hotbar")!.innerHTML = Array.from(
      { length: KEYBOARD_HOTBAR_SLOT_COUNT },
      (_, slot) => this.renderKeyboardSlot(slot),
    ).join("");
    root.querySelector<HTMLDivElement>(".yas-controller-hotbar")!.innerHTML = `
      <div class="yas-controller-diamond">
        ${CONTROLLER_FACE_SLOTS.map(slot => this.renderControllerSlot(slot)).join("")}
      </div>
      <div class="yas-ctrl-separator">RT</div>
      <div class="yas-controller-diamond">
        ${CONTROLLER_MODIFIED_SLOTS.map(slot => this.renderControllerSlot(slot)).join("")}
      </div>`;
    return root;
  }

  private renderKeyboardSlot(slot: number): string {
    const actionId = actionForKeyboardSlot(slot);
    if (!actionId) return `<div class="yas-slot" data-slot="${slot}"><span class="yas-keybind"></span></div>`;
    const action = ACTIONS[actionId];
    return `
      <div class="yas-slot" data-slot="${slot}">
        <span class="yas-keybind"></span>
        <span class="yas-slot-icon">${action.icon}</span>
        <span class="yas-slot-name">${action.label}</span>
        <div class="yas-cd-overlay"></div>
        <div class="yas-cd-text"></div>
      </div>`;
  }

  private renderControllerSlot(slot: ControllerSlotMeta): string {
    const action = slot.action ? ACTIONS[slot.action] : null;
    const cooldownMarkup = slot.action && slot.action !== "jump"
      ? '<div class="yas-cd-overlay"></div><div class="yas-cd-text"></div>'
      : "";
    return `
      <div class="yas-slot yas-ctrl-${slot.position}" data-ctrl-slot="${slot.slot}">
        <span class="yas-keybind"></span>
        ${action ? `<span class="yas-slot-icon">${action.icon}</span><span class="yas-slot-name">${action.label}</span>` : ""}
        ${cooldownMarkup}
      </div>`;
  }

  private buildPartyRow(player: Player): { hpFill: HTMLDivElement; mpFill: HTMLDivElement; rowEl: HTMLDivElement; effectsEl: HTMLDivElement; camBtn?: HTMLButtonElement } {
    const rowEl = document.createElement("div");
    rowEl.className = "party-member";

    // Other players get a camera button to spectate them (only takes effect while you're dead).
    let camBtn: HTMLButtonElement | undefined;
    if (player.id !== this.localPlayerId) {
      camBtn = document.createElement("button");
      camBtn.className = "party-cam-btn";
      camBtn.textContent = "📷";
      camBtn.title = `Spectate ${player.role.toUpperCase()}`;
      camBtn.addEventListener("click", () => {
        this.onSpectate(player.id);
        for (const row of this.partyRows.values()) row.camBtn?.classList.remove("party-cam-active");
        camBtn!.classList.add("party-cam-active");
      });
    }

    const nameEl = document.createElement("span");
    nameEl.className = "party-name";
    nameEl.textContent = player.role.toUpperCase() + (player.id === this.localPlayerId ? " (You)" : "");

    const hpTrack = document.createElement("div");
    hpTrack.className = "party-hp-track";
    const hpFill = document.createElement("div");
    hpFill.className = "party-hp-fill";
    hpFill.style.width = "100%";
    hpTrack.appendChild(hpFill);

    const mpTrack = document.createElement("div");
    mpTrack.className = "party-mp-track";
    const mpFill = document.createElement("div");
    mpFill.className = "party-mp-fill";
    mpFill.style.width = "100%";
    mpTrack.appendChild(mpFill);

    const effectsEl = document.createElement("div");
    effectsEl.className = "party-effects";

    if (camBtn) rowEl.appendChild(camBtn);
    rowEl.append(nameEl, hpTrack, mpTrack, effectsEl);
    return { hpFill, mpFill, rowEl, effectsEl, camBtn };
  }

  applySettings(settings: Settings): void {
    this.currentSettings = { ...settings };
    this.modeToggleBtn.textContent = settings.hotbarMode === "controller" ? "⌨" : "🎮";
    const isCtrl = settings.hotbarMode === "controller";
    this.kbmHotbar.style.display = isCtrl ? "none" : "flex";
    this.controllerHotbar.style.display = isCtrl ? "flex" : "none";
    if (!isCtrl) {
      this.slotKeybinds.forEach((el, i) => {
        const actionId = actionForKeyboardSlot(i);
        el.textContent = actionId ? keyLabel(settings.keyBindings[ACTIONS[actionId].keyBinding]) : "";
      });
    }
  }

  setControllerType(type: ControllerType): void {
    const labels = CONTROLLER_BUTTON_LABELS[type];
    this.controllerHotbar.querySelectorAll<HTMLElement>('[data-ctrl-slot]').forEach(slot => {
      const idx = parseInt(slot.dataset.ctrlSlot ?? '0', 10);
      const keybind = slot.querySelector<HTMLSpanElement>('.yas-keybind');
      if (keybind && idx < labels.length) keybind.textContent = labels[idx]!;
    });
    const separator = this.controllerHotbar.querySelector<HTMLElement>('.yas-ctrl-separator');
    if (separator) {
      separator.textContent = type === 'ps5' ? 'R2' : type === 'nintendo' ? 'ZR' : 'RT';
    }
  }

  private bindEvents(): void {
    this.sprintSlot.addEventListener("click", () => triggerAction("sprint"));
    this.ctrlSprintSlot.addEventListener("click", () => triggerAction("sprint"));
    this.antiKbSlot.addEventListener("click", () => triggerAction("antiKnockback"));
    this.ctrlAntiKbSlot.addEventListener("click", () => triggerAction("antiKnockback"));
    this.provokeSlot.addEventListener("click", () => triggerAction("provoke"));
    this.ctrlProvokeSlot.addEventListener("click", () => triggerAction("provoke"));
    this.invulnBtn.addEventListener("click", () => { this.invulnBtn.blur(); toggleInvincibility(); });

    this.root.querySelectorAll<HTMLDivElement>(".yas-slot").forEach(slot => {
      slot.addEventListener("mousedown", () => this.flashSlot(slot));
    });

    this.modeToggleBtn.addEventListener("click", () => {
      const next: Settings = {
        ...this.currentSettings,
        hotbarMode: this.currentSettings.hotbarMode === "kbm" ? "controller" : "kbm",
      };
      this.onSettingsChange(next);
      this.applySettings(next);
    });
  }

  private flashSlot(slot: HTMLDivElement): void {
    slot.classList.remove("yas-slot-flash");
    void slot.offsetWidth;
    slot.classList.add("yas-slot-flash");
    setTimeout(() => slot.classList.remove("yas-slot-flash"), 180);
  }

  sync(world: World): void {
    const p = world.players.find(player => player.id === this.localPlayerId) ?? world.players[0];

    if (world.status === "cleared") {
      this.statusEl.textContent = "CLEARED";
      this.statusEl.className = "yas-visible yas-cleared";
    } else if (world.status === "wiped") {
      this.statusEl.textContent = "WIPED";
      this.statusEl.className = "yas-visible yas-wiped";
    } else {
      this.statusEl.className = "";
    }

    if (this.partyRows.size === 0 && world.players.length > 0) {
      for (const player of world.players) {
        const row = this.buildPartyRow(player);
        this.partyEl.appendChild(row.rowEl);
        this.partyRows.set(player.id, row);
      }
    }
    // Spectate camera buttons only work while the local player is dead (or has no slot).
    const localAlive = this.localPlayerId
      ? (world.players.find(pl => pl.id === this.localPlayerId)?.alive ?? false)
      : false;
    for (const player of world.players) {
      const row = this.partyRows.get(player.id);
      if (!row) continue;
      // Clickable only while spectating (local dead) and only for a target that's still alive.
      if (row.camBtn) row.camBtn.disabled = localAlive || !player.alive;
      const hpPct = clamp01(player.hp / player.maxHp) * 100;
      const mpPct = clamp01(player.mp / player.maxMp) * 100;
      row.hpFill.style.width = `${hpPct}%`;
      row.mpFill.style.width = `${mpPct}%`;
      row.rowEl.classList.toggle("yas-dead", !player.alive);
      row.effectsEl.replaceChildren();
      for (const effect of activeVisibleEffects(player, world.time)) {
        row.effectsEl.appendChild(buildEffectChip(effect, world.time, "party-effect"));
      }
    }

    const castingChain = world.chains.find(c => !c.resolved && c.showCastBar);
    const castingGroup = world.groupMechanics.find(g => !g.resolved && g.showCastBar);
    const castingGaze = world.gazes.find(g => !g.resolved && g.showCastBar);
    const castingSpreadStack = world.spreadStacks.find(s => !s.resolved && s.showCastBar);
    const casting = world.active.find(m => !m.resolved && m.showCastBar)
      ?? (castingChain && { name: castingChain.name, telegraphStart: castingChain.telegraphStart, resolveAt: castingChain.resolveAt })
      ?? (castingGroup && { name: castingGroup.name, telegraphStart: castingGroup.telegraphStart, resolveAt: castingGroup.resolveAt })
      ?? (castingGaze && { name: castingGaze.name, telegraphStart: castingGaze.telegraphStart, resolveAt: castingGaze.resolveAt })
      ?? (castingSpreadStack && { name: castingSpreadStack.name, telegraphStart: castingSpreadStack.telegraphStart, resolveAt: castingSpreadStack.resolveAt });
    if (casting) {
      const span = casting.resolveAt - casting.telegraphStart;
      const progress = span > 0 ? Math.min(1, (world.time - casting.telegraphStart) / span) : 1;
      const remaining = Math.max(0, casting.resolveAt - world.time);
      this.castBarEl.style.display = "flex";
      this.castNameEl.textContent = casting.name;
      this.castFillEl.style.width = `${progress * 100}%`;
      this.castTimerEl.textContent = remaining.toFixed(1) + "s";
    } else {
      this.castBarEl.style.display = "none";
    }

    if (!p) return;

    const activeDebuffs = activeVisibleEffects(p, world.time).filter(effect => effect.kind === "debuff");
    this.debuffTrackerEl.replaceChildren();
    for (const effect of activeDebuffs) {
      this.debuffTrackerEl.appendChild(buildEffectChip(effect, world.time, "yas-debuff"));
    }

    const hpPct = clamp01(p.hp / p.maxHp) * 100;
    this.hpFill.style.width = `${hpPct}%`;
    this.hpVal.textContent = `${Math.round(p.hp)} / ${p.maxHp}`;
    this.invulnBtn.classList.toggle("is-active", p.invincible);

    const mpPct = clamp01(p.mp / p.maxMp) * 100;
    this.mpFill.style.width = `${mpPct}%`;
    this.mpVal.textContent = `${Math.round(p.mp)} / ${p.maxMp}`;

    this.prevSprintCooldown = this.renderSkillSlots(
      [this.sprintSlot, this.ctrlSprintSlot],
      [{ overlay: this.sprintCdOverlay, text: this.sprintCdText }, { overlay: this.ctrlSprintCdOverlay, text: this.ctrlSprintCdText }],
      p.sprintActive, p.sprintCooldown, SPRINT_COOLDOWN, this.prevSprintCooldown,
    );
    this.prevAntiKbCooldown = this.renderSkillSlots(
      [this.antiKbSlot, this.ctrlAntiKbSlot],
      [{ overlay: this.antiKbCdOverlay, text: this.antiKbCdText }, { overlay: this.ctrlAntiKbCdOverlay, text: this.ctrlAntiKbCdText }],
      p.antiKbActive, p.antiKbCooldown, ANTI_KB_COOLDOWN, this.prevAntiKbCooldown,
    );

    // Provoke is tank-only: show its slots only for a tank local player. No active buff (instantaneous).
    const isTank = p.role === "tank";
    this.provokeSlot.style.display = isTank ? "" : "none";
    this.ctrlProvokeSlot.style.display = isTank ? "" : "none";
    if (isTank) {
      this.prevProvokeCooldown = this.renderSkillSlots(
        [this.provokeSlot, this.ctrlProvokeSlot],
        [{ overlay: this.provokeCdOverlay, text: this.provokeCdText }, { overlay: this.ctrlProvokeCdOverlay, text: this.ctrlProvokeCdText }],
        0, p.provokeCooldown, PROVOKE_COOLDOWN, this.prevProvokeCooldown,
      );
    }
  }

  // Renders a skill's cooldown sweep, ready-pulse, and active highlight across its hotbar slots.
  // Returns the cooldown to remember for the next frame's ready-pulse edge detection.
  private renderSkillSlots(
    slots: HTMLDivElement[],
    cdOverlays: { overlay: HTMLDivElement; text: HTMLDivElement }[],
    activeSecs: number,
    cooldownSecs: number,
    cooldownMax: number,
    prevCooldown: number,
  ): number {
    const onCooldown = cooldownSecs > 0;
    if (onCooldown) {
      const elapsed = (1 - cooldownSecs / cooldownMax) * 360;
      const bg = `conic-gradient(from -90deg, transparent ${elapsed}deg, rgba(0,0,8,0.82) ${elapsed}deg)`;
      for (const { overlay, text } of cdOverlays) {
        overlay.style.display = "block";
        overlay.style.background = bg;
        text.style.display = "flex";
        text.textContent = Math.ceil(cooldownSecs).toString();
      }
    } else {
      for (const { overlay, text } of cdOverlays) {
        overlay.style.display = "none";
        text.style.display = "none";
      }
    }

    if (prevCooldown > 0 && cooldownSecs <= 0) {
      for (const slot of slots) {
        slot.classList.remove("yas-slot-ready");
        void slot.offsetWidth;
        slot.classList.add("yas-slot-ready");
        slot.addEventListener("animationend", () => slot.classList.remove("yas-slot-ready"), { once: true });
      }
    }

    const active = activeSecs > 0 && !onCooldown;
    for (const slot of slots) {
      slot.classList.toggle("yas-slot-sprint-running", active);
    }

    return cooldownSecs;
  }

  dispose(): void {
    this.root.remove();
    this.statusEl.remove();
    this.sessionEl.remove();
    this.partyEl.remove();
    this.castBarEl.remove();
  }
}
