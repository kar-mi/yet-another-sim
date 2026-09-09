import {
  HUD_GROUP_LABELS,
  type HudGroupId,
  type HudGroupLayout,
} from "../settings";
import {
  HUD_HANDLES,
  HUD_MAX_SCALE,
  HUD_MIN_SCALE,
  centeredRect,
  clampCenter,
  fitPlacement,
  groupRect,
  moveGroup,
  resizeGroup,
  type HudHandle,
  type HudMeasure,
  type HudPlacement,
  type HudPoint,
  type HudRect,
  type HudSize,
} from "./hudGeometry";

type HudLayout = Partial<Record<HudGroupId, HudGroupLayout>>;

const GRID_STEP = 0.01;
const PLACEHOLDER: HudSize = { width: 120, height: 32 };
const MAX_CAPTURE_ATTEMPTS = 5;
/** Sub-pixel wobble in measurements and placements is not worth a re-layout. */
const EPSILON = 0.5;

/** The whole visible group: the element plus any control protruding from it. */
function measureBounds(el: HTMLElement): HudRect | null {
  if (el.getClientRects().length === 0) return null;
  const box = el.getBoundingClientRect();
  let left = box.left;
  let top = box.top;
  let right = box.right;
  let bottom = box.bottom;
  const visit = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.getClientRects().length === 0) continue;
      const rect = child.getBoundingClientRect();
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
      if (child.childElementCount === 0) continue;
      // A clipping box already covers everything of its children that is on screen.
      const style = getComputedStyle(child);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") continue;
      visit(child);
    }
  };
  visit(el);
  return { left, top, width: right - left, height: bottom - top };
}

function samePlacement(a: HudPlacement, b: HudPlacement): boolean {
  return Math.abs(a.center.x - b.center.x) < EPSILON
    && Math.abs(a.center.y - b.center.y) < EPSILON
    && Math.abs(a.scale - b.scale) < 0.001;
}

function sameMeasure(a: HudMeasure, b: HudMeasure): boolean {
  return Math.abs(a.natural.width - b.natural.width) < EPSILON
    && Math.abs(a.natural.height - b.natural.height) < EPSILON
    && Math.abs(a.offset.x - b.offset.x) < EPSILON
    && Math.abs(a.offset.y - b.offset.y) < EPSILON;
}

export class HudLayoutManager {
  private readonly groups = new Map<HudGroupId, HTMLElement>();
  private readonly suppressed = new Set<HudGroupId>();
  private readonly revealed = new Set<HudGroupId>();
  private readonly outlines = new Map<HudGroupId, HTMLDivElement>();
  /** Unit-scale bounds of each group, kept while the group is hidden so placeholders stay sized. */
  private readonly measures = new Map<HudGroupId, HudMeasure>();
  /** What is currently on screen: the preferred scale, shrunk where the viewport demanded it. */
  private readonly applied = new Map<HudGroupId, HudPlacement>();
  private readonly pendingRefresh = new Set<HudGroupId>();
  private readonly observers = new Map<HudGroupId, ResizeObserver>();
  private layout: HudLayout;
  private uiScale: number;
  private gridEnabled = false;
  private overlay: HTMLDivElement | null = null;
  private selectionSection: HTMLDivElement | null = null;
  private selected: HudGroupId | null = null;
  private scaleReadout: HTMLElement | null = null;
  private visibleToggle: HTMLInputElement | null = null;
  private captureTokens = new Map<HudGroupId, number>();

  constructor(layout: HudLayout, uiScale: number, private readonly onChange: (layout: HudLayout) => void) {
    this.layout = { ...layout };
    this.uiScale = uiScale;
    window.addEventListener("resize", this.onResize);
  }

  register(id: HudGroupId, el: HTMLElement): void {
    this.groups.set(id, el);
    el.dataset.hudGroup = id;
    el.classList.toggle("yas-hud-suppressed", this.isSuppressed(id));
    this.observe(id, el);
    this.applyGroup(id);
    if (this.overlay) this.createOutline(id);
  }

  unregister(id: HudGroupId): void {
    if (this.groups.has(id) && this.overlay) this.exitEditMode();
    this.observers.get(id)?.disconnect();
    this.observers.delete(id);
    this.groups.delete(id);
    this.captureTokens.delete(id);
    this.measures.delete(id);
    this.applied.delete(id);
    this.pendingRefresh.delete(id);
  }

  hasGroups(): boolean {
    return this.groups.size > 0;
  }

  setHudHidden(hidden: boolean): void {
    for (const el of this.groups.values()) el.classList.toggle("yas-hud-hidden", hidden);
  }

  // Hides a group for as long as the current session needs it gone, leaving the saved layout alone.
  setGroupSuppressed(id: HudGroupId, suppressed: boolean): void {
    if (suppressed) this.suppressed.add(id);
    else this.suppressed.delete(id);
    this.groups.get(id)?.classList.toggle("yas-hud-suppressed", this.isSuppressed(id));
  }

  // Shows a group that the saved layout (or the session) hides, for as long as a transient flow such
  // as the guided tour needs it visible. Never touches the persisted layout.
  setGroupRevealed(id: HudGroupId, revealed: boolean): void {
    if (revealed) this.revealed.add(id);
    else this.revealed.delete(id);
    this.groups.get(id)?.classList.toggle("yas-hud-suppressed", this.isSuppressed(id));
    this.applyGroup(id);
  }

  private isSuppressed(id: HudGroupId): boolean {
    return this.suppressed.has(id) && !this.revealed.has(id);
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
    const viewport = this.viewport();
    const center = { x: entry.x * viewport.width, y: entry.y * viewport.height };
    const preferred = this.uiScale * entry.scale;
    const measure = this.measures.get(id);
    const placement = measure ? fitPlacement(center, preferred, measure, viewport) : { center, scale: preferred };
    const previous = this.applied.get(id);
    if (!previous || !samePlacement(previous, placement)) {
      Object.assign(el.style, {
        position: "fixed",
        left: `${placement.center.x}px`,
        top: `${placement.center.y}px`,
        right: "auto",
        bottom: "auto",
        transform: `translate(-50%, -50%) scale(${placement.scale})`,
        transformOrigin: "center",
      });
      this.applied.set(id, placement);
    }
    el.style.setProperty("--yas-hud-bg-alpha", String(entry.opacity));
    el.style.display = entry.hidden && !this.revealed.has(id) ? "none" : "";
    this.scheduleRefresh(id);
  }

  enterEditMode(): void {
    if (this.overlay || !this.hasGroups()) return;
    const overlay = document.createElement("div");
    overlay.id = "yas-hud-edit-overlay";
    overlay.addEventListener("pointerdown", event => {
      if (event.target === overlay) this.selectGroup(null);
    });
    overlay.addEventListener("contextmenu", event => event.preventDefault());

    const panel = document.createElement("div");
    panel.id = "yas-hud-edit-panel";
    panel.addEventListener("pointerdown", event => event.stopPropagation());
    const title = document.createElement("div");
    title.className = "yas-hud-edit-panel-title";
    title.textContent = "EDIT HUD LAYOUT";
    title.addEventListener("pointerdown", event => this.startPanelDrag(event, panel));
    const hint = document.createElement("div");
    hint.className = "yas-hud-edit-hint";
    hint.textContent = "Drag to move, drag a handle to resize, right-click to hide or show.";
    const globalControls = document.createElement("div");
    globalControls.className = "yas-hud-edit-global-controls";
    const grid = this.makeButton("GRID SNAP: OFF", () => {
      this.gridEnabled = !this.gridEnabled;
      grid.textContent = `GRID SNAP: ${this.gridEnabled ? "ON" : "OFF"}`;
      overlay.classList.toggle("yas-grid-enabled", this.gridEnabled);
    });
    const reset = this.makeButton("RESET ALL", () => this.resetAll());
    const done = this.makeButton("SAVE & CLOSE", () => this.exitEditMode());
    globalControls.append(grid, reset, done);
    const selectionSection = document.createElement("div");
    selectionSection.className = "yas-hud-edit-selection";
    panel.append(title, hint, globalControls, selectionSection);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.selectionSection = selectionSection;
    this.renderSelectionSection();
    for (const id of this.groups.keys()) this.createOutline(id);
  }

  exitEditMode(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.selectionSection = null;
    this.selected = null;
    this.scaleReadout = null;
    this.visibleToggle = null;
    this.outlines.clear();
  }

  private viewport(): HudSize {
    return { width: innerWidth, height: innerHeight };
  }

  private readonly onResize = () => {
    this.applyAll();
    this.positionOutlines();
  };

  private observe(id: HudGroupId, el: HTMLElement): void {
    this.observers.get(id)?.disconnect();
    if (typeof ResizeObserver === "undefined") return;
    // Content that grows or shrinks (a longer cast name, another party row) can push a group out of
    // the viewport, so re-fit whenever its layout size changes.
    const observer = new ResizeObserver(() => this.applyGroup(id));
    observer.observe(el);
    this.observers.set(id, observer);
  }

  private applyAll(): void {
    for (const id of this.groups.keys()) this.applyGroup(id);
  }

  private scheduleRefresh(id: HudGroupId): void {
    if (this.pendingRefresh.has(id)) return;
    this.pendingRefresh.add(id);
    requestAnimationFrame(() => {
      this.pendingRefresh.delete(id);
      if (!this.groups.has(id)) return;
      if (this.remeasure(id)) this.applyGroup(id);
      this.positionOutline(id);
    });
  }

  /** Re-reads the group's bounds; returns whether they moved enough to need a re-fit. */
  private remeasure(id: HudGroupId): boolean {
    const el = this.groups.get(id);
    const placement = this.applied.get(id);
    if (!el || !placement || placement.scale <= 0) return false;
    const bounds = measureBounds(el);
    // A hidden or not-yet-rendered group keeps whatever bounds it last had.
    if (!bounds || bounds.width === 0 || bounds.height === 0) return false;
    const measure: HudMeasure = {
      natural: { width: bounds.width / placement.scale, height: bounds.height / placement.scale },
      offset: {
        x: (bounds.left + bounds.width / 2 - placement.center.x) / placement.scale,
        y: (bounds.top + bounds.height / 2 - placement.center.y) / placement.scale,
      },
    };
    const previous = this.measures.get(id);
    this.measures.set(id, measure);
    return !previous || !sameMeasure(previous, measure);
  }

  private captureDefault(id: HudGroupId, el: HTMLElement, persist = false): void {
    const token = (this.captureTokens.get(id) ?? 0) + 1;
    this.captureTokens.set(id, token);
    this.applied.delete(id);
    this.measures.delete(id);
    el.style.removeProperty("--yas-hud-bg-alpha");
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
    const capture = (attempt: number) => requestAnimationFrame(() => {
      if (this.captureTokens.get(id) !== token || this.groups.get(id) !== el || this.layout[id]) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        if (attempt < MAX_CAPTURE_ATTEMPTS) capture(attempt + 1);
        else this.positionOutline(id);
        return;
      }
      this.layout[id] = {
        x: (rect.left + rect.width / 2) / innerWidth,
        y: (rect.top + rect.height / 2) / innerHeight,
        scale: 1,
        opacity: 1,
        hidden: false,
      };
      this.applyGroup(id);
      if (persist) this.persist();
    });
    capture(1);
  }

  private createOutline(id: HudGroupId): void {
    if (!this.overlay || this.outlines.has(id)) return;
    const outline = document.createElement("div");
    outline.className = "yas-hud-edit-outline";
    // Deliberately not data-hud-group: that attribute carries each group's own positioning CSS.
    outline.dataset.hudOutline = id;
    const label = document.createElement("span");
    label.textContent = HUD_GROUP_LABELS[id];
    outline.appendChild(label);
    for (const handle of HUD_HANDLES) {
      const grip = document.createElement("div");
      grip.className = `yas-hud-edit-handle yas-hud-edit-handle-${handle}`;
      grip.addEventListener("pointerdown", event => this.startResize(event, id, handle));
      outline.appendChild(grip);
    }
    outline.addEventListener("pointerdown", event => this.startDrag(event, id));
    outline.addEventListener("contextmenu", event => {
      event.preventDefault();
      event.stopPropagation();
      this.selectGroup(id);
      this.toggleHidden(id);
    });
    this.overlay.appendChild(outline);
    this.outlines.set(id, outline);
    this.positionOutline(id);
  }

  private measureFor(id: HudGroupId): HudMeasure {
    return this.measures.get(id) ?? { natural: PLACEHOLDER, offset: { x: 0, y: 0 } };
  }

  private placementFor(id: HudGroupId): HudPlacement {
    const applied = this.applied.get(id);
    if (applied) return applied;
    const entry = this.layout[id] ?? this.fallbackLayout(id);
    const viewport = this.viewport();
    return { center: { x: entry.x * viewport.width, y: entry.y * viewport.height }, scale: this.uiScale * entry.scale };
  }

  private startDrag(event: PointerEvent, id: HudGroupId): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectGroup(id);
    const start = this.placementFor(id);
    const measure = this.measureFor(id);
    this.runGesture(event, id, delta => {
      const viewport = this.viewport();
      const grid = this.gridEnabled ? { width: viewport.width * GRID_STEP, height: viewport.height * GRID_STEP } : null;
      if (grid) this.overlay?.classList.add("yas-grid-dragging");
      const next = moveGroup(start, delta, measure, viewport, grid);
      this.updateGroup(id, this.toEntry(next, false));
    });
  }

  private startResize(event: PointerEvent, id: HudGroupId, handle: HudHandle): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectGroup(id);
    const start = this.placementFor(id);
    const measure = this.measureFor(id);
    const limits = { min: this.uiScale * HUD_MIN_SCALE, max: this.uiScale * HUD_MAX_SCALE };
    this.runGesture(event, id, delta => {
      const next = resizeGroup(start, handle, delta, measure, this.viewport(), limits);
      this.updateGroup(id, this.toEntry(next, true));
    });
  }

  /** Turns a screen-space placement back into saved layout values. */
  private toEntry(placement: HudPlacement, withScale: boolean): Partial<HudGroupLayout> {
    const viewport = this.viewport();
    const patch: Partial<HudGroupLayout> = {
      x: placement.center.x / viewport.width,
      y: placement.center.y / viewport.height,
    };
    if (withScale) {
      patch.scale = Math.min(HUD_MAX_SCALE, Math.max(HUD_MIN_SCALE, placement.scale / this.uiScale));
    }
    return patch;
  }

  /** Runs a pointer gesture on an outline, persisting on release and restoring on cancel. */
  private runGesture(event: PointerEvent, id: HudGroupId, onMove: (delta: HudPoint) => void): void {
    const outline = this.outlines.get(id);
    if (!outline) return;
    const before = this.layout[id] ? { ...this.layout[id]! } : null;
    const origin = { x: event.clientX, y: event.clientY };
    outline.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => onMove({ x: moveEvent.clientX - origin.x, y: moveEvent.clientY - origin.y });
    const finish = (endEvent: PointerEvent, cancelled: boolean) => {
      if (outline.hasPointerCapture(endEvent.pointerId)) outline.releasePointerCapture(endEvent.pointerId);
      outline.removeEventListener("pointermove", move);
      outline.removeEventListener("pointerup", up);
      outline.removeEventListener("pointercancel", cancel);
      this.overlay?.classList.remove("yas-grid-dragging");
      if (!cancelled) {
        this.persist();
        return;
      }
      if (before) this.layout[id] = before;
      else delete this.layout[id];
      this.applyGroup(id);
      this.positionOutline(id);
      this.syncSelectionControls();
    };
    const up = (endEvent: PointerEvent) => finish(endEvent, false);
    const cancel = (endEvent: PointerEvent) => finish(endEvent, true);
    outline.addEventListener("pointermove", move);
    outline.addEventListener("pointerup", up);
    outline.addEventListener("pointercancel", cancel);
  }

  private startPanelDrag(event: PointerEvent, panel: HTMLDivElement): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const title = event.currentTarget as HTMLDivElement;
    const rect = panel.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    title.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const panelWidth = panel.offsetWidth;
      const panelHeight = panel.offsetHeight;
      panel.style.transform = "none";
      panel.style.left = `${Math.max(0, Math.min(moveEvent.clientX - offsetX, innerWidth - panelWidth))}px`;
      panel.style.top = `${Math.max(0, Math.min(moveEvent.clientY - offsetY, innerHeight - panelHeight))}px`;
    };
    const up = (upEvent: PointerEvent) => {
      if (title.hasPointerCapture(upEvent.pointerId)) title.releasePointerCapture(upEvent.pointerId);
      title.removeEventListener("pointermove", move);
      title.removeEventListener("pointerup", up);
      title.removeEventListener("pointercancel", up);
    };
    title.addEventListener("pointermove", move);
    title.addEventListener("pointerup", up);
    title.addEventListener("pointercancel", up);
  }

  private selectGroup(id: HudGroupId | null): void {
    this.selected = id;
    for (const [candidate, outline] of this.outlines) outline.classList.toggle("is-selected", candidate === id);
    this.renderSelectionSection();
  }

  private renderSelectionSection(): void {
    const section = this.selectionSection;
    if (!section) return;
    section.replaceChildren();
    this.scaleReadout = null;
    this.visibleToggle = null;
    const id = this.selected;
    if (!id) {
      const hint = document.createElement("div");
      hint.className = "yas-hud-edit-hint";
      hint.textContent = "Select a HUD element";
      section.appendChild(hint);
      return;
    }

    const layout = this.layout[id] ?? this.fallbackLayout(id);
    const heading = document.createElement("div");
    heading.className = "yas-hud-edit-selection-title";
    heading.textContent = HUD_GROUP_LABELS[id];
    const scale = document.createElement("div");
    scale.className = "yas-hud-edit-readout";
    const opacity = this.makeRange("BACKGROUND OPACITY", 0, 1, 0.01, layout.opacity, value => this.updateGroup(id, { opacity: value }, true));
    const visibleLabel = document.createElement("label");
    visibleLabel.className = "yas-hud-edit-visible";
    const visible = document.createElement("input");
    visible.type = "checkbox";
    visible.checked = !layout.hidden;
    visible.addEventListener("change", () => this.updateGroup(id, { hidden: !visible.checked }, true));
    visibleLabel.append(visible, document.createTextNode(" SHOW"));
    const reset = this.makeButton("RESET THIS GROUP", () => this.resetGroup(id));
    section.append(heading, scale, opacity, visibleLabel, reset);
    this.scaleReadout = scale;
    this.visibleToggle = visible;
    this.syncSelectionControls();
  }

  /** Keeps the panel readout and checkbox in step with handle drags and right-click toggles. */
  private syncSelectionControls(): void {
    const id = this.selected;
    if (!id) return;
    const layout = this.layout[id] ?? this.fallbackLayout(id);
    if (this.scaleReadout) this.scaleReadout.textContent = `SCALE: ${Math.round(layout.scale * 100)}%`;
    if (this.visibleToggle) this.visibleToggle.checked = !layout.hidden;
  }

  private makeRange(labelText: string, min: number, max: number, step: number, value: number, onInput: (value: number) => void): HTMLElement {
    const label = document.createElement("label");
    const text = document.createElement("span");
    const caption = (percent: number) => `${labelText}: ${Math.round(percent * 100)}%`;
    text.textContent = caption(value);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener("input", () => {
      const next = Number(input.value);
      text.textContent = caption(next);
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

  private toggleHidden(id: HudGroupId): void {
    const current = this.layout[id] ?? this.fallbackLayout(id);
    this.updateGroup(id, { hidden: !current.hidden }, true);
  }

  private updateGroup(id: HudGroupId, patch: Partial<HudGroupLayout>, persist = false): void {
    const current = this.layout[id] ?? this.fallbackLayout(id);
    this.layout[id] = { ...current, ...patch };
    this.applyGroup(id);
    this.positionOutline(id);
    this.syncSelectionControls();
    if (persist) this.persist();
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
    return {
      x: rect && rect.width ? (rect.left + rect.width / 2) / innerWidth : 0.5,
      y: rect && rect.height ? (rect.top + rect.height / 2) / innerHeight : id === "targetcast" ? 0.3 : 0.5,
      scale: 1,
      opacity: 1,
      hidden: false,
    };
  }

  private isGroupVisible(id: HudGroupId, el: HTMLElement): boolean {
    const entry = this.layout[id];
    if (entry?.hidden && !this.revealed.has(id)) return false;
    if (el.getClientRects().length === 0) return false;
    // The boss cast panel keeps its padding even with no rows to show.
    return !(id === "bosscasts" && el.childElementCount === 0);
  }

  private positionOutline(id: HudGroupId): void {
    const outline = this.outlines.get(id);
    const el = this.groups.get(id);
    if (!outline || !el) return;
    const visible = this.isGroupVisible(id, el);
    const rect = visible ? groupRect(this.placementFor(id), this.measureFor(id)) : this.placeholderRect(id);
    outline.classList.toggle("is-placeholder", !visible);
    Object.assign(outline.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  /** Where a hidden or not-yet-rendered group keeps its draggable stand-in. */
  private placeholderRect(id: HudGroupId): HudRect {
    const entry = this.layout[id] ?? this.fallbackLayout(id);
    const viewport = this.viewport();
    const center = { x: entry.x * viewport.width, y: entry.y * viewport.height };
    const measure = this.measures.get(id);
    if (measure) return groupRect(fitPlacement(center, this.uiScale * entry.scale, measure, viewport), measure);
    return centeredRect(clampCenter(center, PLACEHOLDER, viewport), PLACEHOLDER);
  }

  private positionOutlines(): void {
    for (const id of this.outlines.keys()) this.positionOutline(id);
  }

  private persist(): void {
    this.onChange({ ...this.layout });
  }
}
