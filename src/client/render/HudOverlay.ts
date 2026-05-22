import type { World } from "../../shared/types";
import { pressAction } from "../input";
import { SPRINT_COOLDOWN } from "../../engine/sim";

export class HudOverlay {
  private root: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private mpFill: HTMLDivElement;
  private hpVal: HTMLSpanElement;
  private mpVal: HTMLSpanElement;
  private sprintSlot: HTMLDivElement;
  private sprintCdOverlay: HTMLDivElement;
  private sprintCdText: HTMLDivElement;
  private prevSprintCooldown = 0;

  constructor() {
    this.root = this.buildHud();
    document.body.appendChild(this.root);

    this.hpFill = this.root.querySelector<HTMLDivElement>(".yas-hp-fill")!;
    this.mpFill = this.root.querySelector<HTMLDivElement>(".yas-mp-fill")!;
    this.hpVal = this.root.querySelector<HTMLSpanElement>("[data-hp-val]")!;
    this.mpVal = this.root.querySelector<HTMLSpanElement>("[data-mp-val]")!;
    this.sprintSlot = this.root.querySelector<HTMLDivElement>("[data-slot='0']")!;
    this.sprintCdOverlay = this.root.querySelector<HTMLDivElement>(".yas-cd-overlay")!;
    this.sprintCdText = this.root.querySelector<HTMLDivElement>(".yas-cd-text")!;

    this.statusEl = document.createElement("div");
    this.statusEl.id = "yas-status";
    document.body.appendChild(this.statusEl);

    this.bindEvents();
  }

  private buildHud(): HTMLDivElement {
    const root = document.createElement("div");
    root.id = "yas-hud";

    const keys = ["1","2","3","4","5","6","7","8","9","0"];
    const slots = keys.map((key, i) => {
      if (i === 0) {
        return `
          <div class="yas-slot" data-slot="0">
            <span class="yas-keybind">${key}</span>
            <span class="yas-slot-icon">⚡</span>
            <span class="yas-slot-name">SPRINT</span>
            <div class="yas-cd-overlay"></div>
            <div class="yas-cd-text"></div>
          </div>`;
      }
      return `<div class="yas-slot" data-slot="${i}"><span class="yas-keybind">${key}</span></div>`;
    }).join("");

    root.innerHTML = `
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
      <div class="yas-hotbar-panel">
        <div class="yas-hotbar">${slots}</div>
      </div>
    `;
    return root;
  }

  private bindEvents(): void {
    this.sprintSlot.addEventListener("click", () => pressAction(0));

    this.root.querySelectorAll<HTMLDivElement>(".yas-slot").forEach(slot => {
      slot.addEventListener("mousedown", () => this.flashSlot(slot));
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

    if (!p) return;

    const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp)) * 100;
    this.hpFill.style.width = `${hpPct}%`;
    this.hpVal.textContent = `${Math.round(p.hp)} / ${p.maxHp}`;

    const mpPct = Math.max(0, Math.min(1, p.mp / p.maxMp)) * 100;
    this.mpFill.style.width = `${mpPct}%`;
    this.mpVal.textContent = `${Math.round(p.mp)} / ${p.maxMp}`;

    const onCooldown = p.sprintCooldown > 0;
    if (onCooldown) {
      const elapsed = (1 - p.sprintCooldown / SPRINT_COOLDOWN) * 360;
      this.sprintCdOverlay.style.display = "block";
      this.sprintCdOverlay.style.background =
        `conic-gradient(from -90deg, transparent ${elapsed}deg, rgba(0,0,8,0.82) ${elapsed}deg)`;
      this.sprintCdText.style.display = "flex";
      this.sprintCdText.textContent = Math.ceil(p.sprintCooldown).toString();
    } else {
      this.sprintCdOverlay.style.display = "none";
      this.sprintCdText.style.display = "none";
    }

    if (this.prevSprintCooldown > 0 && p.sprintCooldown <= 0) {
      this.sprintSlot.classList.remove("yas-slot-ready");
      void this.sprintSlot.offsetWidth;
      this.sprintSlot.classList.add("yas-slot-ready");
      this.sprintSlot.addEventListener("animationend", () => {
        this.sprintSlot.classList.remove("yas-slot-ready");
      }, { once: true });
    }

    if (p.sprintActive > 0 && !onCooldown) {
      this.sprintSlot.classList.add("yas-slot-sprint-running");
    } else {
      this.sprintSlot.classList.remove("yas-slot-sprint-running");
    }

    this.prevSprintCooldown = p.sprintCooldown;
  }

  dispose(): void {
    this.root.remove();
    this.statusEl.remove();
  }
}
