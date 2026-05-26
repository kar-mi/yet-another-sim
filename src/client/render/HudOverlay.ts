import type { World, Player } from "../../shared/types";
import { pressAction } from "../input";
import { SPRINT_COOLDOWN } from "../../engine/sim";
import { keyLabel } from "../settings";
import type { Settings } from "../settings";

export class HudOverlay {
  private root: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private mpFill: HTMLDivElement;
  private hpVal: HTMLSpanElement;
  private mpVal: HTMLSpanElement;
  private sprintSlot: HTMLDivElement;
  private sprintKeybind: HTMLSpanElement;
  private sprintCdOverlay: HTMLDivElement;
  private sprintCdText: HTMLDivElement;
  private prevSprintCooldown = 0;
  private sessionEl: HTMLDivElement;
  private partyEl!: HTMLDivElement;
  private partyRows = new Map<string, { hpFill: HTMLDivElement; mpFill: HTMLDivElement; rowEl: HTMLDivElement }>();
  private castBarEl!: HTMLDivElement;
  private castNameEl!: HTMLDivElement;
  private castFillEl!: HTMLDivElement;
  private castTimerEl!: HTMLDivElement;
  private slotKeybinds: HTMLSpanElement[] = [];
  private modeToggleBtn!: HTMLButtonElement;
  private currentSettings!: Settings;
  private kbmHotbar!: HTMLDivElement;
  private controllerHotbar!: HTMLDivElement;
  private ctrlSprintSlot!: HTMLDivElement;
  private ctrlSprintCdOverlay!: HTMLDivElement;
  private ctrlSprintCdText!: HTMLDivElement;

  constructor(sessionId: string, private onSettingsChange: (settings: Settings) => void = () => {}) {
    this.root = this.buildHud();
    document.body.appendChild(this.root);

    this.hpFill = this.root.querySelector<HTMLDivElement>(".yas-hp-fill")!;
    this.mpFill = this.root.querySelector<HTMLDivElement>(".yas-mp-fill")!;
    this.hpVal = this.root.querySelector<HTMLSpanElement>("[data-hp-val]")!;
    this.mpVal = this.root.querySelector<HTMLSpanElement>("[data-mp-val]")!;
    this.sprintSlot = this.root.querySelector<HTMLDivElement>("[data-slot='0']")!;
    this.sprintKeybind = this.sprintSlot.querySelector<HTMLSpanElement>(".yas-keybind")!;
    this.sprintCdOverlay = this.root.querySelector<HTMLDivElement>(".yas-cd-overlay")!;
    this.sprintCdText = this.root.querySelector<HTMLDivElement>(".yas-cd-text")!;
    this.kbmHotbar = this.root.querySelector<HTMLDivElement>(".yas-hotbar")!;
    this.controllerHotbar = this.root.querySelector<HTMLDivElement>(".yas-controller-hotbar")!;
    this.slotKeybinds = Array.from(this.kbmHotbar.querySelectorAll<HTMLSpanElement>(".yas-keybind"));
    this.modeToggleBtn = this.root.querySelector<HTMLButtonElement>(".yas-hotbar-toggle")!;
    this.ctrlSprintSlot = this.controllerHotbar.querySelector<HTMLDivElement>("[data-ctrl-slot='7']")!;
    this.ctrlSprintCdOverlay = this.ctrlSprintSlot.querySelector<HTMLDivElement>(".yas-cd-overlay")!;
    this.ctrlSprintCdText = this.ctrlSprintSlot.querySelector<HTMLDivElement>(".yas-cd-text")!;

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
    const root = document.createElement("div");
    root.id = "yas-hud";

    const kbmSlots = Array.from({ length: 10 }, (_, i) => {
      if (i === 0) {
        return `
          <div class="yas-slot" data-slot="0">
            <span class="yas-keybind"></span>
            <span class="yas-slot-icon">⚡</span>
            <span class="yas-slot-name">SPRINT</span>
            <div class="yas-cd-overlay"></div>
            <div class="yas-cd-text"></div>
          </div>`;
      }
      return `<div class="yas-slot" data-slot="${i}"><span class="yas-keybind"></span></div>`;
    }).join("");

    root.innerHTML = `
      <div class="yas-hotbar-panel">
        <div class="yas-hotbar">${kbmSlots}</div>
        <div class="yas-controller-hotbar" style="display:none">
          <div class="yas-controller-diamond">
            <div class="yas-slot yas-ctrl-top" data-ctrl-slot="3">
              <span class="yas-keybind">Y</span>
              <span class="yas-slot-icon">↑</span>
              <span class="yas-slot-name">JUMP</span>
            </div>
            <div class="yas-slot yas-ctrl-left" data-ctrl-slot="2"><span class="yas-keybind">X</span></div>
            <div class="yas-slot yas-ctrl-right" data-ctrl-slot="1"><span class="yas-keybind">B</span></div>
            <div class="yas-slot yas-ctrl-bottom" data-ctrl-slot="0"><span class="yas-keybind">A</span></div>
          </div>
          <div class="yas-ctrl-separator">LT</div>
          <div class="yas-controller-diamond">
            <div class="yas-slot yas-ctrl-top" data-ctrl-slot="7">
              <span class="yas-keybind">LT+Y</span>
              <span class="yas-slot-icon">⚡</span>
              <span class="yas-slot-name">SPRINT</span>
              <div class="yas-cd-overlay"></div>
              <div class="yas-cd-text"></div>
            </div>
            <div class="yas-slot yas-ctrl-left" data-ctrl-slot="6"><span class="yas-keybind">LT+X</span></div>
            <div class="yas-slot yas-ctrl-right" data-ctrl-slot="5"><span class="yas-keybind">LT+B</span></div>
            <div class="yas-slot yas-ctrl-bottom" data-ctrl-slot="4"><span class="yas-keybind">LT+A</span></div>
          </div>
        </div>
        <button class="yas-hotbar-toggle" title="Switch input display">⌨</button>
      </div>
      <div class="yas-resource-panel">
        <div class="yas-bar-row">
          <span class="yas-bar-label">HP</span>
          <div class="yas-bar-track">
            <div class="yas-bar-fill yas-hp-fill" style="width:100%"></div>
            <span class="yas-bar-val" data-hp-val>100 / 100</span>
          </div>
        </div>
        <div class="yas-bar-row">
          <span class="yas-bar-label">MP</span>
          <div class="yas-bar-track">
            <div class="yas-bar-fill yas-mp-fill" style="width:100%"></div>
            <span class="yas-bar-val" data-mp-val>10000 / 10000</span>
          </div>
        </div>
      </div>
    `;
    return root;
  }

  private buildPartyRow(player: Player): { hpFill: HTMLDivElement; mpFill: HTMLDivElement; rowEl: HTMLDivElement } {
    const rowEl = document.createElement("div");
    rowEl.className = "party-member";

    const nameEl = document.createElement("span");
    nameEl.className = "party-name";
    nameEl.textContent = player.role.toUpperCase() + (player.control === "human" ? " (You)" : "");

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

    rowEl.append(nameEl, hpTrack, mpTrack);
    return { hpFill, mpFill, rowEl };
  }

  applySettings(settings: Settings): void {
    this.currentSettings = { ...settings };
    this.modeToggleBtn.textContent = settings.hotbarMode === "controller" ? "⌨" : "🎮";
    const isCtrl = settings.hotbarMode === "controller";
    this.kbmHotbar.style.display = isCtrl ? "none" : "flex";
    this.controllerHotbar.style.display = isCtrl ? "flex" : "none";
    if (!isCtrl) {
      this.slotKeybinds.forEach((el, i) => {
        el.textContent = i === 0 ? keyLabel(settings.keyBindings.sprint) : "";
      });
    }
  }

  private bindEvents(): void {
    this.sprintSlot.addEventListener("click", () => pressAction(0));
    this.ctrlSprintSlot.addEventListener("click", () => pressAction(7));

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
    const p = world.players[0];

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
    for (const player of world.players) {
      const row = this.partyRows.get(player.id);
      if (!row) continue;
      const hpPct = Math.max(0, Math.min(1, player.hp / player.maxHp)) * 100;
      const mpPct = Math.max(0, Math.min(1, player.mp / player.maxMp)) * 100;
      row.hpFill.style.width = `${hpPct}%`;
      row.mpFill.style.width = `${mpPct}%`;
      row.rowEl.classList.toggle("yas-dead", !player.alive);
    }

    const casting = world.active.find(m => !m.resolved && m.showCastBar);
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

    const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp)) * 100;
    this.hpFill.style.width = `${hpPct}%`;
    this.hpVal.textContent = `${Math.round(p.hp)} / ${p.maxHp}`;

    const mpPct = Math.max(0, Math.min(1, p.mp / p.maxMp)) * 100;
    this.mpFill.style.width = `${mpPct}%`;
    this.mpVal.textContent = `${Math.round(p.mp)} / ${p.maxMp}`;

    const onCooldown = p.sprintCooldown > 0;
    const cdOverlays = [
      { overlay: this.sprintCdOverlay, text: this.sprintCdText },
      { overlay: this.ctrlSprintCdOverlay, text: this.ctrlSprintCdText },
    ];
    if (onCooldown) {
      const elapsed = (1 - p.sprintCooldown / SPRINT_COOLDOWN) * 360;
      const bg = `conic-gradient(from -90deg, transparent ${elapsed}deg, rgba(0,0,8,0.82) ${elapsed}deg)`;
      for (const { overlay, text } of cdOverlays) {
        overlay.style.display = "block";
        overlay.style.background = bg;
        text.style.display = "flex";
        text.textContent = Math.ceil(p.sprintCooldown).toString();
      }
    } else {
      for (const { overlay, text } of cdOverlays) {
        overlay.style.display = "none";
        text.style.display = "none";
      }
    }

    const sprintSlots = [this.sprintSlot, this.ctrlSprintSlot];
    if (this.prevSprintCooldown > 0 && p.sprintCooldown <= 0) {
      for (const slot of sprintSlots) {
        slot.classList.remove("yas-slot-ready");
        void slot.offsetWidth;
        slot.classList.add("yas-slot-ready");
        slot.addEventListener("animationend", () => slot.classList.remove("yas-slot-ready"), { once: true });
      }
    }

    const sprintActive = p.sprintActive > 0 && !onCooldown;
    for (const slot of sprintSlots) {
      slot.classList.toggle("yas-slot-sprint-running", sprintActive);
    }

    this.prevSprintCooldown = p.sprintCooldown;
  }

  dispose(): void {
    this.root.remove();
    this.statusEl.remove();
    this.sessionEl.remove();
    this.partyEl.remove();
    this.castBarEl.remove();
  }
}
