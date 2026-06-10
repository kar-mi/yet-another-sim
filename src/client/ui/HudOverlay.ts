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
  type ActionId,
  type ControllerSlotMeta,
} from "../actions";
import { keyLabel } from "../settings";
import type { Settings, ControllerType } from "../settings";
import { clamp01 } from "../../shared/math";

declare const __YAS_DEBUG__: boolean | undefined;

const DEBUG_POSITION_ENABLED = typeof __YAS_DEBUG__ !== "undefined" && __YAS_DEBUG__;
const PARTY_SLOT_ORDER = ["mt", "ot", "h1", "h2", "m1", "m2", "r1", "r2"] as const;
const PARTY_SLOT_INDEX = new Map<string, number>(PARTY_SLOT_ORDER.map((id, index) => [id, index]));
const EFFECT_TIMER_STEP = 0.25;

type EffectKind = Player["effects"][number]["kind"];
type EffectChipHandle = { expiresAt: number; timerEl: HTMLSpanElement };
type EffectRenderState = { ids: string[]; timerBucket: number; chips: EffectChipHandle[] };
type PartyRow = {
  hpFill: HTMLDivElement;
  mpFill: HTMLDivElement;
  rowEl: HTMLDivElement;
  effectsEl: HTMLDivElement;
  effectState: EffectRenderState;
  camBtn?: HTMLButtonElement;
};

function createEffectRenderState(): EffectRenderState {
  return { ids: [], timerBucket: -1, chips: [] };
}

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
    case "dot": {
      const c = effect.behavior.condition;
      return { glyph: c === "moving" ? "🔥" : c === "idle" ? "❄" : "🩸" };
    }
    default: return { glyph: effect.kind === "buff" ? "▲" : "●" };
  }
}

function isActiveVisibleEffect(effect: Player["effects"][number], time: number, kind: EffectKind | null = null): boolean {
  return effect.visibility !== "invisible"
    && effect.appliedAt + effect.duration > time
    && (kind === null || effect.kind === kind);
}

function hasSameActiveEffects(
  player: Player,
  time: number,
  ids: string[],
  kind: EffectKind | null = null,
): boolean {
  let index = 0;
  for (const effect of player.effects) {
    if (!isActiveVisibleEffect(effect, time, kind)) continue;
    if (ids[index] !== effect.id) return false;
    index++;
  }
  return index === ids.length;
}

function activeEffectIds(player: Player, time: number, kind: EffectKind | null = null): string[] {
  const ids: string[] = [];
  for (const effect of player.effects) {
    if (isActiveVisibleEffect(effect, time, kind)) ids.push(effect.id);
  }
  return ids;
}

function sortedActiveVisibleEffects(player: Player, time: number, kind: EffectKind | null = null): Player["effects"] {
  const effects: Array<{ effect: Player["effects"][number]; index: number }> = [];
  for (let index = 0; index < player.effects.length; index++) {
    const effect = player.effects[index];
    if (isActiveVisibleEffect(effect, time, kind)) effects.push({ effect, index });
  }
  effects.sort((a, b) => {
    const aPlant = a.effect.behavior.kind === "plant";
    const bPlant = b.effect.behavior.kind === "plant";
    if (aPlant && bPlant) return (a.effect.plantSlot ?? a.index) - (b.effect.plantSlot ?? b.index);
    return a.index - b.index;
  });
  return effects.map(entry => entry.effect);
}

function partySortIndex(player: Player): number {
  return PARTY_SLOT_INDEX.get(player.id) ?? PARTY_SLOT_ORDER.length;
}

function orderedPartyPlayers(players: Player[], localPlayerId: string | null): Player[] {
  return [...players].sort((a, b) => {
    if (a.id === localPlayerId) return -1;
    if (b.id === localPlayerId) return 1;
    const orderDelta = partySortIndex(a) - partySortIndex(b);
    return orderDelta || a.id.localeCompare(b.id);
  });
}

function effectTimerBucket(time: number): number {
  return Math.floor(time / EFFECT_TIMER_STEP);
}

function formatEffectTime(expiresAt: number, time: number): string {
  return `${Math.ceil(Math.max(0, expiresAt - time))}s`;
}

function buildEffectChip(
  effect: Player["effects"][number],
  time: number,
  className: string,
): { element: HTMLSpanElement; handle: EffectChipHandle } {
  const effectEl = document.createElement("span");
  effectEl.className = `${className} ${className}-${effect.kind}`;
  effectEl.title = effect.name;
  const icon = effectIcon(effect);
  let iconEl: HTMLElement;
  if (effect.icon) {
    const img = document.createElement("img");
    img.src = `/static/effects/${effect.icon}`;
    img.alt = effect.name;
    iconEl = img;
  } else {
    iconEl = document.createElement("span");
    iconEl.textContent = icon.glyph;
  }
  iconEl.className = `${className}-icon`;
  if (icon.rotate !== undefined) iconEl.style.transform = `rotate(${icon.rotate}deg)`;
  const timerEl = document.createElement("span");
  timerEl.className = `${className}-timer`;
  const expiresAt = effect.appliedAt + effect.duration;
  timerEl.textContent = formatEffectTime(expiresAt, time);
  effectEl.append(iconEl, timerEl);
  return { element: effectEl, handle: { expiresAt, timerEl } };
}

function syncEffectChips(
  container: HTMLElement,
  state: EffectRenderState,
  player: Player,
  time: number,
  className: string,
  kind: EffectKind | null = null,
): void {
  const bucket = effectTimerBucket(time);
  if (!hasSameActiveEffects(player, time, state.ids, kind)) {
    const elements: HTMLSpanElement[] = [];
    const chips: EffectChipHandle[] = [];
    for (const effect of sortedActiveVisibleEffects(player, time, kind)) {
      const chip = buildEffectChip(effect, time, className);
      elements.push(chip.element);
      chips.push(chip.handle);
    }
    container.replaceChildren(...elements);
    state.ids = activeEffectIds(player, time, kind);
    state.chips = chips;
    state.timerBucket = bucket;
    return;
  }
  if (state.timerBucket === bucket) return;
  state.timerBucket = bucket;
  for (const chip of state.chips) {
    chip.timerEl.textContent = formatEffectTime(chip.expiresAt, time);
  }
}

// One hotbar skill (sprint/anti-kb/provoke), bundling its keyboard + controller slot elements and
// per-slot cooldown overlays so the sync loop can treat all skills uniformly. Built from ACTIONS
// metadata in the constructor.
interface SkillSlotView {
  action: ActionId;
  slots: HTMLDivElement[];
  cdOverlays: { overlay: HTMLDivElement; text: HTMLDivElement }[];
  prevCooldown: number;
  tankOnly: boolean;
  read: (p: Player) => { activeSecs: number; cooldownSecs: number; cooldownMax: number };
}

export class HudOverlay {
  private root: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private mpFill: HTMLDivElement;
  private hpVal: HTMLSpanElement;
  private mpVal: HTMLSpanElement;
  private invulnBtn: HTMLButtonElement;
  private skillSlots: SkillSlotView[] = [];
  private sessionEl: HTMLDivElement;
  private partyEl!: HTMLDivElement;
  private partyRows = new Map<string, PartyRow>();
  private castBarEl!: HTMLDivElement;
  private castNameEl!: HTMLDivElement;
  private castFillEl!: HTMLDivElement;
  private castTimerEl!: HTMLDivElement;
  private slotKeybinds: HTMLSpanElement[] = [];
  private modeToggleBtn!: HTMLButtonElement;
  private debugPositionBtn: HTMLButtonElement | null = null;
  private currentSettings!: Settings;
  private latestPlayer: Player | null = null;
  private debuffTrackerEl!: HTMLDivElement;
  private debuffTrackerState = createEffectRenderState();
  private kbmHotbar!: HTMLDivElement;
  private controllerHotbar!: HTMLDivElement;

  constructor(
    sessionId: string,
    private readonly localPlayerId: string | null = null,
    private onSettingsChange: (settings: Settings) => void = () => {},
    private onSpectate: (id: string) => void = () => {},
    private onDebugPosition: (position: { playerId: string; x: number; y: number; z: number }) => void = () => {},
  ) {
    this.root = this.buildHud();
    document.body.appendChild(this.root);

    this.hpFill = this.root.querySelector<HTMLDivElement>(".yas-hp-fill")!;
    this.mpFill = this.root.querySelector<HTMLDivElement>(".yas-mp-fill")!;
    this.hpVal = this.root.querySelector<HTMLSpanElement>("[data-hp-val]")!;
    this.mpVal = this.root.querySelector<HTMLSpanElement>("[data-mp-val]")!;
    this.invulnBtn = this.root.querySelector<HTMLButtonElement>(".yas-invuln-btn")!;
    this.debuffTrackerEl = this.root.querySelector<HTMLDivElement>(".yas-debuff-tracker")!;
    this.kbmHotbar = this.root.querySelector<HTMLDivElement>(".yas-hotbar")!;
    this.controllerHotbar = this.root.querySelector<HTMLDivElement>(".yas-controller-hotbar")!;
    this.slotKeybinds = Array.from(this.kbmHotbar.querySelectorAll<HTMLSpanElement>(".yas-keybind"));
    this.modeToggleBtn = this.root.querySelector<HTMLButtonElement>(".yas-hotbar-toggle")!;
    this.debugPositionBtn = this.root.querySelector<HTMLButtonElement>(".yas-hotbar-debug")!;
    if (!DEBUG_POSITION_ENABLED) {
      this.debugPositionBtn.remove();
      this.debugPositionBtn = null;
    }
    const skillSpecs: { action: ActionId; tankOnly?: boolean; read: SkillSlotView["read"] }[] = [
      { action: "sprint", read: p => ({ activeSecs: p.sprintActive, cooldownSecs: p.sprintCooldown, cooldownMax: SPRINT_COOLDOWN }) },
      { action: "antiKnockback", read: p => ({ activeSecs: p.antiKbActive, cooldownSecs: p.antiKbCooldown, cooldownMax: ANTI_KB_COOLDOWN }) },
      { action: "provoke", tankOnly: true, read: p => ({ activeSecs: 0, cooldownSecs: p.provokeCooldown, cooldownMax: PROVOKE_COOLDOWN }) },
    ];
    this.skillSlots = skillSpecs.map(spec => {
      const meta = ACTIONS[spec.action];
      const slots = [
        this.root.querySelector<HTMLDivElement>(`[data-slot='${meta.keyboardSlot}']`)!,
        this.controllerHotbar.querySelector<HTMLDivElement>(`[data-ctrl-slot='${meta.controllerSlot}']`)!,
      ];
      return {
        action: spec.action,
        slots,
        cdOverlays: slots.map(slot => ({
          overlay: slot.querySelector<HTMLDivElement>(".yas-cd-overlay")!,
          text: slot.querySelector<HTMLDivElement>(".yas-cd-text")!,
        })),
        prevCooldown: 0,
        tankOnly: spec.tankOnly ?? false,
        read: spec.read,
      };
    });

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

  private buildPartyRow(player: Player): PartyRow {
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
    nameEl.textContent = player.id.toUpperCase() + (player.id === this.localPlayerId ? " (You)" : "");

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
    return { hpFill, mpFill, rowEl, effectsEl, effectState: createEffectRenderState(), camBtn };
  }

  private ensurePartyRows(players: Player[]): void {
    if (this.partyRows.size === players.length) return;
    for (const player of orderedPartyPlayers(players, this.localPlayerId)) {
      if (this.partyRows.has(player.id)) continue;
      const row = this.buildPartyRow(player);
      this.partyEl.appendChild(row.rowEl);
      this.partyRows.set(player.id, row);
    }
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
    for (const view of this.skillSlots) {
      for (const slot of view.slots) slot.addEventListener("click", () => triggerAction(view.action));
    }
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
    this.debugPositionBtn?.addEventListener("click", () => this.logCurrentPosition());
  }

  private flashSlot(slot: HTMLDivElement): void {
    slot.classList.remove("yas-slot-flash");
    void slot.offsetWidth;
    slot.classList.add("yas-slot-flash");
    setTimeout(() => slot.classList.remove("yas-slot-flash"), 180);
  }

  sync(world: World): void {
    const p = world.players.find(player => player.id === this.localPlayerId) ?? world.players[0];
    this.latestPlayer = p ?? null;

    if (world.status === "cleared") {
      this.statusEl.textContent = "CLEARED";
      this.statusEl.className = "yas-visible yas-cleared";
    } else if (world.status === "wiped") {
      this.statusEl.textContent = "WIPED";
      this.statusEl.className = "yas-visible yas-wiped";
    } else {
      this.statusEl.className = "";
    }

    this.ensurePartyRows(world.players);
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
      syncEffectChips(row.effectsEl, row.effectState, player, world.time, "party-effect");
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

    syncEffectChips(this.debuffTrackerEl, this.debuffTrackerState, p, world.time, "yas-debuff", "debuff");

    const hpPct = clamp01(p.hp / p.maxHp) * 100;
    this.hpFill.style.width = `${hpPct}%`;
    this.hpVal.textContent = `${Math.round(p.hp)} / ${p.maxHp}`;
    this.invulnBtn.classList.toggle("is-active", p.invincible);

    const mpPct = clamp01(p.mp / p.maxMp) * 100;
    this.mpFill.style.width = `${mpPct}%`;
    this.mpVal.textContent = `${Math.round(p.mp)} / ${p.maxMp}`;

    // Provoke is tank-only: show its slots only for a tank local player. No active buff (instantaneous).
    const isTank = p.role === "tank";
    for (const view of this.skillSlots) {
      if (view.tankOnly) {
        for (const slot of view.slots) slot.style.display = isTank ? "" : "none";
        if (!isTank) continue;
      }
      const { activeSecs, cooldownSecs, cooldownMax } = view.read(p);
      view.prevCooldown = this.renderSkillSlots(view.slots, view.cdOverlays, activeSecs, cooldownSecs, cooldownMax, view.prevCooldown);
    }
  }

  private logCurrentPosition(): void {
    const player = this.latestPlayer;
    if (!player) return;
    this.onDebugPosition({
      playerId: player.id,
      x: Number(player.pos.x.toFixed(3)),
      y: Number(player.y.toFixed(3)),
      z: Number(player.pos.z.toFixed(3)),
    });
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
