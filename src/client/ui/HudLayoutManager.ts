import {
  HUD_GROUP_LABELS,
  type HudGroupId,
  type HudGroupLayout,
} from "../settings";

type HudLayout = Partial<Record<HudGroupId, HudGroupLayout>>;

const GRID_STEP = 0.01;
const PLACEHOLDER_WIDTH = 220;
const PLACEHOLDER_HEIGHT = 56;

export class HudLayoutManager {
  private readonly groups = new Map<HudGroupId, HTMLElement>();
  private readonly outlines = new Map<HudGroupId, HTMLDivElement>();
  private layout: HudLayout;
  private uiScale: number;
  private gridEnabled = false;
  private overlay: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private selected: HudGroupId | null = null;
  private captureTokens = new Map<HudGroupId, number>();

  constructor(layout: HudLayout, uiScale: number, private readonly onChange: (layout: HudLayout) => void) {
    this.layout = { ...layout };
    this.uiScale = uiScale;
    window.addEventListener("resize", this.onResize);
  }

  register(id: HudGroupId, el: HTMLElement): void {
    this.groups.set(id, el);
    el.dataset.hudGroup = id;
    this.applyGroup(id);
    if (this.overlay) this.createOutline(id);
  }

  unregister(id: HudGroupId): void {
    if (this.groups.has(id) && this.overlay) this.exitEditMode();
    this.groups.delete(id);
    this.captureTokens.delete(id);
  }

  hasGroups(): boolean {
    return this.groups.size > 0;
  }

  setHudHidden(hidden: boolean): void {
    for (const el of this.groups.values()) el.classList.toggle("yas-hud-hidden", hidden);
  }

  setLayout(layout: HudLayout): void {
    this.layout = { ...layout };
    this.applyAll();
  }

  setUiScale(scale: number): void {
    this.uiScale = scale;
    this.applyAll();
  }

  applyGroup(id: HudGroupId): void {
    const el = this.groups.get(id);
    if (!el) return;
    const entry = this.layout[id];
    if (!entry) {
      this.captureDefault(id, el);
      return;
    }
    const scale = this.uiScale * entry.scale;
    Object.assign(el.style, {
      position: "fixed",
      left: `${entry.x * 100}vw`,
      top: `${entry.y * 100}vh`,
      right: "auto",
      bottom: "auto",
      transform: `scale(${scale})`,
      transformOrigin: "top left",
      opacity: String(entry.opacity),
      display: entry.hidden ? "none" : "",
    });
    requestAnimationFrame(() => this.positionOutline(id));
  }

  enterEditMode(): void {
    if (this.overlay || !this.hasGroups()) return;
    const overlay = document.createElement("div");
    overlay.id = "yas-hud-edit-overlay";
    overlay.addEventListener("pointerdown", event => {
      if (event.target === overlay) this.selectGroup(null);
    });

    const toolbar = document.createElement("div");
    toolbar.className = "yas-hud-edit-toolbar";
    const title = document.createElement("span");
    title.textContent = "EDIT HUD — drag a group or select it for controls";
    const grid = this.makeButton("GRID: OFF", () => {
      this.gridEnabled = !this.gridEnabled;
      grid.textContent = `GRID: ${this.gridEnabled ? "ON" : "OFF"}`;
      overlay.classList.toggle("yas-grid-enabled", this.gridEnabled);
    });
    const reset = this.makeButton("RESET ALL", () => this.resetAll());
    const done = this.makeButton("DONE", () => this.exitEditMode());
    toolbar.append(title, grid, reset, done);
    overlay.appendChild(toolbar);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    for (const id of this.groups.keys()) this.createOutline(id);
  }

  exitEditMode(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.panel = null;
    this.selected = null;
    this.outlines.clear();
  }

  private readonly onResize = () => {
    this.applyAll();
    this.positionOutlines();
  };

  private applyAll(): void {
    for (const id of this.groups.keys()) this.applyGroup(id);
  }

  private captureDefault(id: HudGroupId, el: HTMLElement, persist = false): void {
    const token = (this.captureTokens.get(id) ?? 0) + 1;
    this.captureTokens.set(id, token);
    Object.assign(el.style, {
      left: "",
      top: "",
      right: "",
      bottom: "",
      transform: "",
      transformOrigin: "",
      opacity: "",
      display: "",
    });
    requestAnimationFrame(() => {
      if (this.captureTokens.get(id) !== token || this.groups.get(id) !== el || this.layout[id]) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        requestAnimationFrame(() => {
          if (this.captureTokens.get(id) === token && !this.layout[id]) this.captureDefault(id, el, persist);
        });
        return;
      }
      this.layout[id] = {
        x: rect.left / innerWidth,
        y: rect.top / innerHeight,
        scale: 1,
        opacity: 1,
        hidden: false,
      };
      this.applyGroup(id);
      if (persist) this.persist();
    });
  }

  private createOutline(id: HudGroupId): void {
    if (!this.overlay || this.outlines.has(id)) return;
    const outline = document.createElement("div");
    outline.className = "yas-hud-edit-outline";
    outline.dataset.hudGroup = id;
    const label = document.createElement("span");
    label.textContent = HUD_GROUP_LABELS[id];
    outline.appendChild(label);
    outline.addEventListener("pointerdown", event => this.startDrag(event, id));
    this.overlay.appendChild(outline);
    this.outlines.set(id, outline);
    this.positionOutline(id);
  }

  private startDrag(event: PointerEvent, id: HudGroupId): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectGroup(id);
    const outline = this.outlines.get(id)!;
    outline.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = this.layout[id] ?? this.fallbackLayout(id);
    const move = (moveEvent: PointerEvent) => {
      let x = initial.x + (moveEvent.clientX - startX) / innerWidth;
      let y = initial.y + (moveEvent.clientY - startY) / innerHeight;
      if (this.gridEnabled) {
        x = Math.round(x / GRID_STEP) * GRID_STEP;
        y = Math.round(y / GRID_STEP) * GRID_STEP;
        this.overlay?.classList.add("yas-grid-dragging");
      }
      const rect = outline.getBoundingClientRect();
      x = Math.max(0, Math.min(x, 1 - rect.width / innerWidth));
      y = Math.max(0, Math.min(y, 1 - rect.height / innerHeight));
      this.layout[id] = { ...initial, x, y };
      this.applyGroup(id);
      this.positionPanel();
    };
    const up = () => {
      outline.removeEventListener("pointermove", move);
      outline.removeEventListener("pointerup", up);
      outline.removeEventListener("pointercancel", up);
      this.overlay?.classList.remove("yas-grid-dragging");
      this.persist();
    };
    outline.addEventListener("pointermove", move);
    outline.addEventListener("pointerup", up);
    outline.addEventListener("pointercancel", up);
  }

  private selectGroup(id: HudGroupId | null): void {
    this.selected = id;
    for (const [candidate, outline] of this.outlines) outline.classList.toggle("is-selected", candidate === id);
    this.panel?.remove();
    this.panel = null;
    if (!id || !this.overlay) return;

    const layout = this.layout[id] ?? this.fallbackLayout(id);
    const panel = document.createElement("div");
    panel.id = "yas-hud-edit-panel";
    const heading = document.createElement("div");
    heading.className = "yas-hud-edit-panel-title";
    heading.textContent = HUD_GROUP_LABELS[id];
    const scale = this.makeRange("SCALE", 0.5, 2, 0.05, layout.scale, value => this.updateGroup(id, { scale: value }));
    const opacity = this.makeRange("OPACITY", 0.2, 1, 0.05, layout.opacity, value => this.updateGroup(id, { opacity: value }));
    const visibleLabel = document.createElement("label");
    visibleLabel.className = "yas-hud-edit-visible";
    const visible = document.createElement("input");
    visible.type = "checkbox";
    visible.checked = !layout.hidden;
    visible.addEventListener("change", () => this.updateGroup(id, { hidden: !visible.checked }));
    visibleLabel.append(visible, document.createTextNode(" SHOW"));
    const reset = this.makeButton("RESET THIS GROUP", () => this.resetGroup(id));
    panel.append(heading, scale, opacity, visibleLabel, reset);
    panel.addEventListener("pointerdown", event => event.stopPropagation());
    this.overlay.appendChild(panel);
    this.panel = panel;
    this.positionPanel();
  }

  private makeRange(labelText: string, min: number, max: number, step: number, value: number, onInput: (value: number) => void): HTMLElement {
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = `${labelText}: ${value.toFixed(2)}`;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener("input", () => {
      const next = Number(input.value);
      text.textContent = `${labelText}: ${next.toFixed(2)}`;
      onInput(next);
    });
    label.append(text, input);
    return label;
  }

  private makeButton(text: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  private updateGroup(id: HudGroupId, patch: Partial<HudGroupLayout>): void {
    const current = this.layout[id] ?? this.fallbackLayout(id);
    this.layout[id] = { ...current, ...patch };
    this.applyGroup(id);
    this.positionOutline(id);
    this.positionPanel();
    this.persist();
  }

  private resetGroup(id: HudGroupId): void {
    delete this.layout[id];
    this.persist();
    this.selectGroup(null);
    const el = this.groups.get(id);
    if (el) this.captureDefault(id, el, true);
  }

  private resetAll(): void {
    for (const id of this.groups.keys()) delete this.layout[id];
    this.persist();
    this.selectGroup(null);
    for (const [id, el] of this.groups) this.captureDefault(id, el, true);
  }

  private fallbackLayout(id: HudGroupId): HudGroupLayout {
    const el = this.groups.get(id);
    const rect = el?.getBoundingClientRect();
    const targetCastX = (innerWidth / 2 - 160) / innerWidth;
    return {
      x: rect && rect.width ? rect.left / innerWidth : id === "targetcast" ? targetCastX : 0.5,
      y: rect && rect.height ? rect.top / innerHeight : id === "targetcast" ? 0.3 : 0.5,
      scale: 1,
      opacity: 1,
      hidden: false,
    };
  }

  private positionOutline(id: HudGroupId): void {
    const outline = this.outlines.get(id);
    const el = this.groups.get(id);
    if (!outline || !el) return;
    const entry = this.layout[id] ?? this.fallbackLayout(id);
    const rect = el.getBoundingClientRect();
    const hidden = entry.hidden || rect.width === 0 || rect.height === 0
      || (id === "bosscasts" && el.childElementCount === 0);
    const left = hidden ? entry.x * innerWidth : rect.left;
    const top = hidden ? entry.y * innerHeight : rect.top;
    Object.assign(outline.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${hidden ? PLACEHOLDER_WIDTH : rect.width}px`,
      height: `${hidden ? PLACEHOLDER_HEIGHT : rect.height}px`,
    });
  }

  private positionOutlines(): void {
    for (const id of this.outlines.keys()) this.positionOutline(id);
    this.positionPanel();
  }

  private positionPanel(): void {
    if (!this.panel || !this.selected) return;
    const outline = this.outlines.get(this.selected);
    if (!outline) return;
    const rect = outline.getBoundingClientRect();
    const panelRect = this.panel.getBoundingClientRect();
    const left = Math.min(innerWidth - panelRect.width - 12, Math.max(12, rect.right + 10));
    const top = Math.min(innerHeight - panelRect.height - 12, Math.max(54, rect.top));
    Object.assign(this.panel.style, { left: `${left}px`, top: `${top}px` });
  }

  private persist(): void {
    this.onChange({ ...this.layout });
  }
}
