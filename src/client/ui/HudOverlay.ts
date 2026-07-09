import type { World, Player, Boss } from "@shared/types";
import { triggerAction, toggleInvincibility, getActiveModifier } from "../input";
import { SPRINT_COOLDOWN, ANTI_KB_COOLDOWN, PROVOKE_COOLDOWN } from "@shared/constants";
import {
  ACTIONS,
  CONTROLLER_FACE_BUTTONS,
  CONTROLLER_DPAD_BUTTONS,
  CONTROLLER_BUTTON_POSITION,
  CONTROLLER_GLYPHS,
  KEYBOARD_HOTBAR_SLOT_COUNT,
  actionForKeyboardSlot,
  actionForCombo,
  buttonGlyph,
  type ActionId,
  type ControllerButtonId,
} from "../actions";
import { keyLabel } from "../settings";
import type { Settings, ControllerType } from "../settings";
import type { PlaybackState } from "@shared/protocol";
import { clamp01 } from "@shared/math";
import { createEffectRenderState, syncEffectChips, type EffectRenderState } from "./effectChips";
import {
  combinePositionFrames,
  invertFramePosition,
  positionFrameOptions,
  type PositionFrameOption,
} from "../frameReadout";
import type { HudLayoutManager } from "./HudLayoutManager";

declare const __YAS_DEBUG__: boolean | undefined;

const DEBUG_ENABLED = typeof __YAS_DEBUG__ !== "undefined" && __YAS_DEBUG__;
const DEBUG_POSITION_ENABLED = DEBUG_ENABLED;
const PARTY_SLOT_ORDER = ["mt", "ot", "h1", "h2", "m1", "m2", "r1", "r2"] as const;
const PARTY_SLOT_INDEX = new Map<string, number>(PARTY_SLOT_ORDER.map((id, index) => [id, index]));
type PartyRow = {
  hpFill: HTMLDivElement;
  mpFill: HTMLDivElement;
  wrapEl: HTMLDivElement;
  rowEl: HTMLDivElement;
  statusDot: HTMLSpanElement;
  effectsEl: HTMLDivElement;
  effectState: EffectRenderState;
  camBtn?: HTMLButtonElement;
};

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function partySortIndex(player: Player): number {
  return PARTY_SLOT_INDEX.get(player.id) ?? PARTY_SLOT_ORDER.length;
}

// Skip a DOM write when the value is unchanged. Reading an inline style / textContent is cheap and
// doesn't force layout, but writing one can, so dirty-checking avoids per-frame style/layout churn
// across the local bars, all 8 party rows, and the hotbar cooldown sweeps.
function setWidth(el: HTMLElement, value: string): void {
  if (el.style.width !== value) el.style.width = value;
}
function setText(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}
function setBackground(el: HTMLElement, value: string): void {
  if (el.style.background !== value) el.style.background = value;
}

type CastCandidate = { name: string; telegraphStart: number; resolveAt: number; bossId: string };

function buildCastCandidates(world: World): CastCandidate[] {
  const defaultBossId = world.bosses[0]?.id ?? "";
  const candidates: CastCandidate[] = [];
  for (const m of world.active) {
    if (!m.resolved && m.showCastBar)
      candidates.push({ name: m.name, telegraphStart: m.telegraphStart, resolveAt: m.resolveAt, bossId: m.bossId ?? defaultBossId });
  }
  for (const m of world.chains) {
    if (!m.resolved && m.showCastBar)
      candidates.push({ name: m.name, telegraphStart: m.telegraphStart, resolveAt: m.resolveAt, bossId: defaultBossId });
  }
  for (const m of world.groupMechanics) {
    if (!m.resolved && m.showCastBar)
      candidates.push({ name: m.name, telegraphStart: m.telegraphStart, resolveAt: m.resolveAt, bossId: defaultBossId });
  }
  for (const m of world.gazes) {
    if (!m.resolved && m.showCastBar)
      candidates.push({ name: m.name, telegraphStart: m.telegraphStart, resolveAt: m.resolveAt, bossId: defaultBossId });
  }
  for (const m of world.spreadStacks) {
    if (!m.resolved && m.showCastBar)
      candidates.push({ name: m.name, telegraphStart: m.telegraphStart, resolveAt: m.resolveAt, bossId: defaultBossId });
  }
  return candidates;
}

function castForBoss(bossId: string, candidates: CastCandidate[]): CastCandidate | null {
  return candidates.find(c => c.bossId === bossId) ?? null;
}

function orderedPartyPlayers(players: Player[], localPlayerId: string | null): Player[] {
  return [...players].sort((a, b) => {
    if (a.id === localPlayerId) return -1;
    if (b.id === localPlayerId) return 1;
    const orderDelta = partySortIndex(a) - partySortIndex(b);
    return orderDelta || a.id.localeCompare(b.id);
  });
}

// Reads a skill's live cooldown/active state off a player snapshot.
type SkillRead = (p: Player) => { activeSecs: number; cooldownSecs: number; cooldownMax: number };

// A skill with a cooldown (sprint/anti-kb/provoke). Drives both the static keyboard hotbar
// and the layer-aware controller hotbar.
interface SkillSpec {
  action: ActionId;
  tankOnly: boolean;
  read: SkillRead;
}

// One keyboard hotbar slot bundling its cooldown overlay so the sync loop can treat skills
// uniformly. Built from ACTIONS metadata in the constructor.
interface SkillSlotView {
  action: ActionId;
  slots: HTMLDivElement[];
  cdOverlays: { overlay: HTMLDivElement; text: HTMLDivElement }[];
  prevCooldown: number;
  tankOnly: boolean;
  read: SkillRead;
}

type BossCastRow = {
  rowEl: HTMLDivElement;
  fillEl: HTMLDivElement;
  mechEl: HTMLSpanElement;
};

// One controller hotbar button cell (a fixed face/dpad position). Its displayed action is
// re-projected every frame from the active modifier layer.
interface CtrlSlotView {
  el: HTMLDivElement;
  icon: HTMLSpanElement;
  name: HTMLSpanElement;
  cdOverlay: HTMLDivElement;
  cdText: HTMLDivElement;
  current?: ActionId;
}

export class HudOverlay {
  private root: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private mpFill: HTMLDivElement;
  private hpVal: HTMLSpanElement;
  private mpVal: HTMLSpanElement;
  private invulnBtn: HTMLButtonElement;
  private botInvulnBtn: HTMLButtonElement;
  private skillSpecs: SkillSpec[] = [];
  private kbSkillSlots: SkillSlotView[] = [];
  private ctrlSlots = new Map<ControllerButtonId, CtrlSlotView>();
  private ctrlPrevCooldown = new Map<ActionId, number>();
  private ctrlSeparatorEl!: HTMLDivElement;
  private currentControllerType: ControllerType = "unknown";
  private sessionEl: HTMLDivElement;
  private timerEl: HTMLDivElement;
  private timerValEl: HTMLSpanElement;
  private timerStatusEl: HTMLSpanElement;
  private playbackState: PlaybackState = "playing";
  private lastWorldStatus: World["status"] = "running";
  private partyEl!: HTMLDivElement;
  private partyRows = new Map<string, PartyRow>();
  private castBarEl!: HTMLDivElement;
  private castNameEl!: HTMLDivElement;
  private castFillEl!: HTMLDivElement;
  private castTimerEl!: HTMLDivElement;
  private slotKeybinds: HTMLSpanElement[] = [];
  private modeToggleBtn!: HTMLButtonElement;
  private debugPositionBtn: HTMLButtonElement | null = null;
  private positionHelperEl: HTMLDivElement | null = null;
  private positionFrameEl: HTMLButtonElement | null = null;
  private positionFrameModalEl: HTMLDivElement | null = null;
  private positionFrameOptionsEl: HTMLDivElement | null = null;
  private positionFrameDoneEl: HTMLButtonElement | null = null;
  private positionReadoutEl: HTMLPreElement | null = null;
  private positionFrameOptions: PositionFrameOption[] = [];
  private selectedPositionFrameKeys = new Set<string>();
  private positionFrameSignature = "";
  private currentSettings!: Settings;
  private latestPlayer: Player | null = null;
  private latestWorld: World | null = null;
  private debuffTrackerEl!: HTMLDivElement;
  private debuffTrackerState = createEffectRenderState();
  private kbmHotbar!: HTMLDivElement;
  private controllerHotbar!: HTMLDivElement;
  private bossCastPanelEl!: HTMLDivElement;
  private bossCastRows = new Map<string, BossCastRow>();
  private bossCastKey = "";
  private hotbarGroupEl!: HTMLDivElement;
  private resourceGroupEl!: HTMLDivElement;

  constructor(
    sessionId: string,
    private readonly localPlayerId: string | null,
    private onSettingsChange: (settings: Settings) => void,
    private onSpectate: (id: string) => void,
    private onDebugPosition: (position: { playerId: string; x: number; y: number; z: number }) => void,
    private onBotsInvincibleChange: (enabled: boolean) => void,
    private hudLayout: HudLayoutManager,
  ) {
    this.root = this.buildHud();
    document.body.appendChild(this.root);

    this.hpFill = this.root.querySelector<HTMLDivElement>(".yas-hp-fill")!;
    this.mpFill = this.root.querySelector<HTMLDivElement>(".yas-mp-fill")!;
    this.hpVal = this.root.querySelector<HTMLSpanElement>("[data-hp-val]")!;
    this.mpVal = this.root.querySelector<HTMLSpanElement>("[data-mp-val]")!;
    this.invulnBtn = this.root.querySelector<HTMLButtonElement>(".yas-invuln-btn")!;
    this.botInvulnBtn = this.root.querySelector<HTMLButtonElement>(".yas-bot-invuln-btn")!;
    this.debuffTrackerEl = this.root.querySelector<HTMLDivElement>(".yas-debuff-tracker")!;
    this.kbmHotbar = this.root.querySelector<HTMLDivElement>(".yas-hotbar")!;
    this.controllerHotbar = this.root.querySelector<HTMLDivElement>(".yas-controller-hotbar")!;
    this.bossCastPanelEl = this.root.querySelector<HTMLDivElement>(".yas-boss-cast-panel")!;
    this.hotbarGroupEl = this.root.querySelector<HTMLDivElement>('[data-hud-group="hotbar"]')!;
    this.resourceGroupEl = this.root.querySelector<HTMLDivElement>('[data-hud-group="resources"]')!;
    this.slotKeybinds = Array.from(this.kbmHotbar.querySelectorAll<HTMLSpanElement>(".yas-keybind"));
    this.modeToggleBtn = this.root.querySelector<HTMLButtonElement>(".yas-hotbar-toggle")!;
    this.debugPositionBtn = this.root.querySelector<HTMLButtonElement>(".yas-hotbar-debug")!;
    this.positionHelperEl = this.root.querySelector<HTMLDivElement>(".yas-position-helper")!;
    this.positionFrameEl = this.root.querySelector<HTMLButtonElement>(".yas-position-frame")!;
    this.positionFrameModalEl = this.root.querySelector<HTMLDivElement>(".yas-position-frame-modal")!;
    this.positionFrameOptionsEl = this.root.querySelector<HTMLDivElement>(".yas-position-frame-options")!;
    this.positionFrameDoneEl = this.root.querySelector<HTMLButtonElement>(".yas-position-frame-done")!;
    this.positionReadoutEl = this.root.querySelector<HTMLPreElement>(".yas-position-readout")!;
    if (!DEBUG_POSITION_ENABLED) {
      this.positionHelperEl.remove();
      this.debugPositionBtn = null;
      this.positionHelperEl = null;
      this.positionFrameEl = null;
      this.positionFrameModalEl = null;
      this.positionFrameOptionsEl = null;
      this.positionFrameDoneEl = null;
      this.positionReadoutEl = null;
    }
    this.skillSpecs = [
      { action: "sprint", tankOnly: false, read: p => ({ activeSecs: p.sprintActive, cooldownSecs: p.sprintCooldown, cooldownMax: SPRINT_COOLDOWN }) },
      { action: "antiKnockback", tankOnly: false, read: p => ({ activeSecs: p.antiKbActive, cooldownSecs: p.antiKbCooldown, cooldownMax: ANTI_KB_COOLDOWN }) },
      { action: "provoke", tankOnly: true, read: p => ({ activeSecs: 0, cooldownSecs: p.provokeCooldown, cooldownMax: PROVOKE_COOLDOWN }) },
    ];
    this.kbSkillSlots = this.skillSpecs.map(spec => {
      const meta = ACTIONS[spec.action];
      const slots = [this.root.querySelector<HTMLDivElement>(`[data-slot='${meta.keyboardSlot}']`)!];
      return {
        action: spec.action,
        slots,
        cdOverlays: slots.map(slot => ({
          overlay: slot.querySelector<HTMLDivElement>(".yas-cd-overlay")!,
          text: slot.querySelector<HTMLDivElement>(".yas-cd-text")!,
        })),
        prevCooldown: 0,
        tankOnly: spec.tankOnly,
        read: spec.read,
      };
    });

    this.ctrlSeparatorEl = this.controllerHotbar.querySelector<HTMLDivElement>(".yas-ctrl-separator")!;
    for (const button of [...CONTROLLER_FACE_BUTTONS, ...CONTROLLER_DPAD_BUTTONS]) {
      const el = this.controllerHotbar.querySelector<HTMLDivElement>(`[data-ctrl-btn='${button}']`)!;
      this.ctrlSlots.set(button, {
        el,
        icon: el.querySelector<HTMLSpanElement>(".yas-slot-icon")!,
        name: el.querySelector<HTMLSpanElement>(".yas-slot-name")!,
        cdOverlay: el.querySelector<HTMLDivElement>(".yas-cd-overlay")!,
        cdText: el.querySelector<HTMLDivElement>(".yas-cd-text")!,
      });
    }

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

    // Pull timer, sitting beside the raid selector. Driven by world.time, which advances only while
    // the pull is playing — so it resets on restart and freezes on pause / raid end automatically.
    this.timerEl = document.createElement("div");
    this.timerEl.id = "yas-timer";
    const timerLabel = document.createElement("span");
    timerLabel.className = "yas-session-label";
    timerLabel.textContent = "TIMER";
    this.timerValEl = document.createElement("span");
    this.timerValEl.className = "yas-timer-val";
    this.timerValEl.textContent = "00:00";
    this.timerStatusEl = document.createElement("span");
    this.timerStatusEl.className = "yas-timer-status";
    this.timerStatusEl.textContent = "RUNNING";
    this.timerEl.append(timerLabel, this.timerValEl, this.timerStatusEl);
    document.body.appendChild(this.timerEl);

    this.partyEl = document.createElement("div");
    this.partyEl.id = "yas-party";
    document.body.appendChild(this.partyEl);

    this.castBarEl = document.createElement("div");
    this.castBarEl.id = "yas-cast-bar";
    this.castNameEl = document.createElement("div");
    this.castNameEl.className = "yas-cast-name";
    const castTrack = document.createElement("div");
    castTrack.className = "yas-cast-track";
    this.castFillEl = document.createElement("div");
    this.castFillEl.className = "yas-cast-fill";
    this.castTimerEl = document.createElement("div");
    this.castTimerEl.className = "yas-cast-timer";
    if (!DEBUG_ENABLED) this.castTimerEl.style.display = "none";
    castTrack.appendChild(this.castFillEl);
    this.castBarEl.append(this.castNameEl, castTrack, this.castTimerEl);
    document.body.appendChild(this.castBarEl);

    document.body.append(...Array.from(this.root.children));
    this.root.remove();
    this.hudLayout.register("party", this.partyEl);
    this.hudLayout.register("hotbar", this.hotbarGroupEl);
    this.hudLayout.register("debuffs", this.debuffTrackerEl);
    this.hudLayout.register("resources", this.resourceGroupEl);
    this.hudLayout.register("targetcast", this.castBarEl);
    this.hudLayout.register("bosscasts", this.bossCastPanelEl);
    this.hudLayout.register("timer", this.timerEl);

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
        ${CONTROLLER_FACE_BUTTONS.map(button => this.renderControllerSlot(button)).join("")}
      </div>
      <div class="yas-ctrl-separator">—</div>
      <div class="yas-controller-diamond">
        ${CONTROLLER_DPAD_BUTTONS.map(button => this.renderControllerSlot(button)).join("")}
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

  // A controller button cell. Icon/name/cooldown are filled per-frame from the active layer.
  private renderControllerSlot(button: ControllerButtonId): string {
    const position = CONTROLLER_BUTTON_POSITION[button];
    return `
      <div class="yas-slot yas-ctrl-${position}" data-ctrl-btn="${button}">
        <span class="yas-keybind"></span>
        <span class="yas-slot-icon"></span>
        <span class="yas-slot-name"></span>
        <div class="yas-cd-overlay"></div>
        <div class="yas-cd-text"></div>
      </div>`;
  }

  private buildPartyRow(player: Player): PartyRow {
    const wrapEl = document.createElement("div");
    wrapEl.className = "party-row";

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

    const nameRowEl = document.createElement("div");
    nameRowEl.className = "party-name-row";

    const nameEl = document.createElement("span");
    nameEl.className = "party-name";
    nameEl.textContent = player.id.toUpperCase() + (player.id === this.localPlayerId ? " (You)" : "");

    const statusDot = document.createElement("span");
    statusDot.className = "party-status-dot";
    statusDot.setAttribute("aria-hidden", "true");

    nameRowEl.append(nameEl, statusDot);

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
    rowEl.append(nameRowEl, hpTrack, mpTrack);
    wrapEl.append(rowEl, effectsEl);
    return { hpFill, mpFill, wrapEl, rowEl, statusDot, effectsEl, effectState: createEffectRenderState(), camBtn };
  }

  private ensurePartyRows(players: Player[]): void {
    if (this.partyRows.size === players.length) return;
    for (const player of orderedPartyPlayers(players, this.localPlayerId)) {
      if (this.partyRows.has(player.id)) continue;
      const row = this.buildPartyRow(player);
      this.partyEl.appendChild(row.wrapEl);
      this.partyRows.set(player.id, row);
    }
  }

  private ensureBossCastRows(bosses: Boss[]): void {
    const key = bosses.map(b => b.id).join(",");
    if (this.bossCastKey === key) return;
    this.bossCastKey = key;
    this.bossCastPanelEl.innerHTML = "";
    this.bossCastRows.clear();
    for (const boss of bosses) {
      const rowEl = document.createElement("div");
      rowEl.className = "yas-boss-cast-row";
      const nameEl = document.createElement("span");
      nameEl.className = "yas-boss-cast-label";
      nameEl.textContent = boss.id.toUpperCase();
      const trackEl = document.createElement("div");
      trackEl.className = "yas-boss-cast-track";
      const fillEl = document.createElement("div");
      fillEl.className = "yas-boss-cast-fill";
      const mechEl = document.createElement("span");
      mechEl.className = "yas-boss-cast-mech";
      trackEl.append(fillEl, mechEl);
      rowEl.append(nameEl, trackEl);
      this.bossCastPanelEl.appendChild(rowEl);
      this.bossCastRows.set(boss.id, { rowEl, fillEl, mechEl });
    }
  }

  // Playback state (playing/paused/stopped/done) is a separate channel from world.status, fed in via
  // the net "playback" message. The timer word reflects it while the pull is live; a finished pull
  // (cleared/wiped) takes precedence.
  setPlaybackState(state: PlaybackState): void {
    this.playbackState = state;
    this.renderTimerStatus(this.lastWorldStatus);
    this.renderCenterStatus(this.lastWorldStatus);
  }

  private renderTimerStatus(worldStatus: World["status"]): void {
    this.lastWorldStatus = worldStatus;
    let word: string;
    let modifier: string;
    if (worldStatus === "cleared") {
      word = "CLEARED";
      modifier = "cleared";
    } else if (worldStatus === "wiped") {
      word = "WIPED";
      modifier = "wiped";
    } else if (this.playbackState === "paused") {
      word = "PAUSED";
      modifier = "paused";
    } else if (this.playbackState === "stopped") {
      word = "STOPPED";
      modifier = "stopped";
    } else {
      word = "RUNNING";
      modifier = "running";
    }
    this.timerStatusEl.textContent = word;
    this.timerStatusEl.className = `yas-timer-status yas-timer-${modifier}`;
  }

  private renderCenterStatus(worldStatus: World["status"]): void {
    if (worldStatus === "cleared") {
      this.statusEl.textContent = "CLEARED";
      this.statusEl.className = "yas-visible yas-cleared";
    } else if (worldStatus === "wiped") {
      this.statusEl.textContent = "WIPED";
      this.statusEl.className = "yas-visible yas-wiped";
    } else if (this.playbackState === "paused") {
      this.statusEl.textContent = "PAUSED";
      this.statusEl.className = "yas-visible yas-paused";
    } else if (this.playbackState === "stopped") {
      this.statusEl.textContent = "STOPPED";
      this.statusEl.className = "yas-visible yas-stopped";
    } else {
      this.statusEl.className = "";
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
    this.currentControllerType = type;
    const glyphs = CONTROLLER_GLYPHS[type];
    for (const [button, view] of this.ctrlSlots) {
      const keybind = view.el.querySelector<HTMLSpanElement>('.yas-keybind');
      if (keybind) keybind.textContent = buttonGlyph(button, glyphs);
    }
    // The separator's modifier label is refreshed each frame from the held modifier.
  }

  private bindEvents(): void {
    for (const view of this.kbSkillSlots) {
      for (const slot of view.slots) slot.addEventListener("click", () => triggerAction(view.action));
    }
    for (const view of this.ctrlSlots.values()) {
      view.el.addEventListener("click", () => { if (view.current) triggerAction(view.current); });
    }
    this.invulnBtn.addEventListener("click", () => { this.invulnBtn.blur(); toggleInvincibility(); });
    this.botInvulnBtn.addEventListener("click", () => {
      const enabled = !this.botInvulnBtn.classList.contains("is-active");
      this.botInvulnBtn.blur();
      this.onBotsInvincibleChange(enabled);
    });

    this.hotbarGroupEl.querySelectorAll<HTMLDivElement>(".yas-slot").forEach(slot => {
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
    this.positionFrameEl?.addEventListener("click", () => {
      if (this.positionFrameModalEl) this.positionFrameModalEl.hidden = !this.positionFrameModalEl.hidden;
    });
    this.positionFrameDoneEl?.addEventListener("click", () => {
      if (this.positionFrameModalEl) this.positionFrameModalEl.hidden = true;
    });
    this.positionReadoutEl?.addEventListener("click", () => {
      const text = this.positionReadoutEl?.textContent;
      if (text) void navigator.clipboard.writeText(text);
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
    this.latestPlayer = p ?? null;
    this.latestWorld = world;
    if (DEBUG_POSITION_ENABLED && p) this.syncPositionFrames(world, p);
    const botPlayers = world.players.filter(player => player.control === "bot");
    this.botInvulnBtn.classList.toggle("is-active", botPlayers.length > 0 && botPlayers.every(player => player.invincible));

    this.timerValEl.textContent = formatTime(world.time);
    this.renderTimerStatus(world.status);
    this.renderCenterStatus(world.status);

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
      setWidth(row.hpFill, `${hpPct}%`);
      setWidth(row.mpFill, `${mpPct}%`);
      row.rowEl.classList.toggle("yas-dead", !player.alive);
      row.statusDot.classList.toggle("is-joined", player.control === "human");
      row.statusDot.classList.toggle("is-bot", player.control === "bot");
      row.statusDot.title = player.control === "human" ? "Player joined" : "Bot slot";
      syncEffectChips(row.effectsEl, row.effectState, player, world.time, "party-effect");
    }

    const candidates = buildCastCandidates(world);
    const targetBossId = p?.targetBossId ?? world.bosses[0]?.id;
    const casting = targetBossId ? castForBoss(targetBossId, candidates) : null;
    if (casting) {
      const span = casting.resolveAt - casting.telegraphStart;
      const progress = span > 0 ? Math.min(1, (world.time - casting.telegraphStart) / span) : 1;
      this.castBarEl.classList.add("is-active");
      this.castNameEl.textContent = casting.name;
      this.castFillEl.style.width = `${progress * 100}%`;
      if (DEBUG_ENABLED) {
        const remaining = Math.max(0, casting.resolveAt - world.time);
        this.castTimerEl.textContent = remaining.toFixed(1) + "s";
      }
    } else {
      this.castBarEl.classList.remove("is-active");
    }

    this.ensureBossCastRows(world.bosses);
    for (const boss of world.bosses) {
      const row = this.bossCastRows.get(boss.id);
      if (!row) continue;
      const cast = castForBoss(boss.id, candidates);
      if (cast) {
        const span = cast.resolveAt - cast.telegraphStart;
        const progress = span > 0 ? Math.min(1, (world.time - cast.telegraphStart) / span) : 1;
        setWidth(row.fillEl, `${progress * 100}%`);
        setText(row.mechEl, cast.name);
      } else {
        setWidth(row.fillEl, "0%");
        setText(row.mechEl, "");
      }
    }

    if (!p) return;

    syncEffectChips(this.debuffTrackerEl, this.debuffTrackerState, p, world.time, "yas-debuff", "debuff");

    const hpPct = clamp01(p.hp / p.maxHp) * 100;
    setWidth(this.hpFill, `${hpPct}%`);
    setText(this.hpVal, `${Math.round(p.hp)} / ${p.maxHp}`);
    this.invulnBtn.classList.toggle("is-active", p.invincible);

    const mpPct = clamp01(p.mp / p.maxMp) * 100;
    setWidth(this.mpFill, `${mpPct}%`);
    setText(this.mpVal, `${Math.round(p.mp)} / ${p.maxMp}`);

    // Provoke is tank-only: show its slots only for a tank local player. No active buff (instantaneous).
    const isTank = p.role === "tank";
    for (const view of this.kbSkillSlots) {
      if (view.tankOnly) {
        for (const slot of view.slots) slot.style.display = isTank ? "" : "none";
        if (!isTank) continue;
      }
      const { activeSecs, cooldownSecs, cooldownMax } = view.read(p);
      view.prevCooldown = this.renderSkillSlots(view.slots, view.cdOverlays, activeSecs, cooldownSecs, cooldownMax, view.prevCooldown);
    }

    if (this.currentSettings?.hotbarMode === "controller") this.syncControllerHotbar(p, isTank);
  }

  // Projects the active modifier layer onto the 8 controller button cells: each cell shows the
  // action bound to {activeModifier, button} (icon/label + cooldown), or is cleared if unbound.
  private syncControllerHotbar(p: Player, isTank: boolean): void {
    const bindings = this.currentSettings.controllerBindings;
    const active = getActiveModifier();
    const glyphs = CONTROLLER_GLYPHS[this.currentControllerType];
    this.ctrlSeparatorEl.textContent = active === "none" ? "—" : glyphs.modifiers[active];
    this.ctrlSeparatorEl.classList.toggle("is-active", active !== "none");

    for (const [button, view] of this.ctrlSlots) {
      const actionId = actionForCombo(bindings, active, button);
      const hidden = !actionId || (actionId === "provoke" && !isTank);
      if (hidden) {
        view.current = undefined;
        view.icon.textContent = "";
        view.name.textContent = "";
        view.cdOverlay.style.display = "none";
        view.cdText.style.display = "none";
        view.el.classList.remove("yas-slot-sprint-running");
        continue;
      }
      view.current = actionId;
      view.icon.textContent = ACTIONS[actionId].icon;
      view.name.textContent = ACTIONS[actionId].label;
      const spec = this.skillSpecs.find(s => s.action === actionId);
      if (spec) {
        const { activeSecs, cooldownSecs, cooldownMax } = spec.read(p);
        const prev = this.ctrlPrevCooldown.get(actionId) ?? 0;
        const next = this.renderSkillSlots(
          [view.el],
          [{ overlay: view.cdOverlay, text: view.cdText }],
          activeSecs, cooldownSecs, cooldownMax, prev,
        );
        this.ctrlPrevCooldown.set(actionId, next);
      } else {
        // No cooldown (jump): clear any leftover overlay.
        view.cdOverlay.style.display = "none";
        view.cdText.style.display = "none";
      }
    }
  }

  private logCurrentPosition(): void {
    const player = this.latestPlayer;
    const world = this.latestWorld;
    if (!player || !world) return;
    const selected = Array.from(this.selectedPositionFrameKeys)
      .map(key => this.positionFrameOptions.find(option => option.key === key))
      .filter((option): option is PositionFrameOption => option !== undefined);
    const frame = selected.length > 1
      ? combinePositionFrames(selected, world)
      : selected[0] ?? this.positionFrameOptions[0];
    if (this.positionReadoutEl) {
      const worldLine = `world  { x: ${player.pos.x.toFixed(3)}, z: ${player.pos.z.toFixed(3)} }`;
      if (frame?.north) {
        const readout = invertFramePosition(player.pos, frame.north, frame.rightSign);
        this.positionReadoutEl.textContent = [
          frame.descriptor ?? frame.label,
          worldLine,
          `r/z    { r: ${readout.r.toFixed(3)}, z: ${readout.z.toFixed(3)} }`,
          `polar  { dist: ${readout.dist.toFixed(3)}, angleDeg: ${readout.angleDeg.toFixed(1)} }`,
        ].join("\n");
      } else {
        this.positionReadoutEl.textContent = frame?.key === "world"
          ? worldLine
          : selected.length > 1 && !frame
            ? `selected frames cannot be combined\n${worldLine}`
            : `${frame?.descriptor ?? frame?.label ?? "frame"}\nframe unavailable\n${worldLine}`;
      }
      this.positionReadoutEl.classList.add("is-visible");
    }
    this.onDebugPosition({
      playerId: player.id,
      x: Number(player.pos.x.toFixed(3)),
      y: Number(player.y.toFixed(3)),
      z: Number(player.pos.z.toFixed(3)),
    });
  }

  private syncPositionFrames(world: World, player: Player): void {
    const options = positionFrameOptions(world, player);
    this.positionFrameOptions = options;
    const signature = options.map(option => `${option.key}:${option.north ? "1" : "0"}`).join("|");
    if (!this.positionFrameEl || !this.positionFrameOptionsEl || signature === this.positionFrameSignature) return;
    this.positionFrameSignature = signature;
    const validKeys = new Set(options
      .filter(option => option.key === "world" || option.north)
      .map(option => option.key));
    this.selectedPositionFrameKeys = new Set(
      Array.from(this.selectedPositionFrameKeys).filter(key => validKeys.has(key)),
    );
    if (this.selectedPositionFrameKeys.size === 0) this.selectedPositionFrameKeys.add("world");

    const optionEls = options.map(option => {
      const label = document.createElement("label");
      label.className = "yas-position-frame-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = option.key;
      input.checked = this.selectedPositionFrameKeys.has(option.key);
      input.disabled = option.key !== "world" && !option.north;
      const text = document.createElement("span");
      text.textContent = option.label;
      input.addEventListener("change", () => {
        if (input.checked) {
          if (!option.refs) {
            this.selectedPositionFrameKeys = new Set([option.key]);
          } else {
            for (const key of this.selectedPositionFrameKeys) {
              if (!options.find(candidate => candidate.key === key)?.refs) {
                this.selectedPositionFrameKeys.delete(key);
              }
            }
            this.selectedPositionFrameKeys.add(option.key);
          }
        } else {
          this.selectedPositionFrameKeys.delete(option.key);
          if (this.selectedPositionFrameKeys.size === 0) this.selectedPositionFrameKeys.add("world");
        }
        this.syncPositionFramePicker();
      });
      label.append(input, text);
      return label;
    });
    this.positionFrameOptionsEl.replaceChildren(...optionEls);
    this.syncPositionFramePicker();
  }

  private syncPositionFramePicker(): void {
    if (!this.positionFrameEl || !this.positionFrameOptionsEl) return;
    for (const input of this.positionFrameOptionsEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      const option = this.positionFrameOptions.find(candidate => candidate.key === input.value);
      if (option) input.checked = this.selectedPositionFrameKeys.has(option.key);
    }
    const selected = this.positionFrameOptions.filter(option => this.selectedPositionFrameKeys.has(option.key));
    this.positionFrameEl.textContent = selected.length === 1
      ? selected[0]!.label
      : `${selected.length} frames selected`;
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
      // Quantize the sweep to whole degrees so the (long) conic-gradient string only changes ~360
      // times over a cooldown instead of every frame; setBackground/setText then skip the no-ops.
      const elapsed = Math.round((1 - cooldownSecs / cooldownMax) * 360);
      const bg = `conic-gradient(from -90deg, transparent ${elapsed}deg, rgba(0,0,8,0.82) ${elapsed}deg)`;
      const label = Math.ceil(cooldownSecs).toString();
      for (const { overlay, text } of cdOverlays) {
        overlay.style.display = "block";
        setBackground(overlay, bg);
        text.style.display = "flex";
        setText(text, label);
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
    this.hudLayout.exitEditMode();
    for (const id of ["party", "hotbar", "debuffs", "resources", "targetcast", "bosscasts", "timer"] as const) {
      this.hudLayout.unregister(id);
    }
    this.hotbarGroupEl.remove();
    this.debuffTrackerEl.remove();
    this.resourceGroupEl.remove();
    this.bossCastPanelEl.remove();
    this.statusEl.remove();
    this.sessionEl.remove();
    this.timerEl.remove();
    this.partyEl.remove();
    this.castBarEl.remove();
  }
}
