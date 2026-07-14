import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { clamp01 } from "@shared/math";

type HealthBarOptions = {
  trackWidthPx: number;
  trackHeightPx?: number;
  offsetYPx: number;
  offsetForwardWorld?: number;
  color: string;
  showLabel?: boolean;
  cornerRadiusPx?: number;
  borderColor?: string;
  backgroundColor?: string;
  labelFontSizePx?: number;
};

type HealthBar = {
  track: Rectangle;
  fill: Rectangle;
  label: TextBlock | null;
  lastPct: number;
  lastColor: string;
  lastLabel: string;
};

// One shared fullscreen GUI projects every health bar via linkWithMesh, instead of a per-mesh
// AdvancedDynamicTexture + billboard plane + material (which also forced a computeWorldMatrix +
// getBoundingInfo per bar every frame). The GUI re-projects linked controls each frame on its own,
// so `set` only touches the fill width + visibility. Trade-off: the bars draw as a 2D overlay (no
// 3D occlusion), which is fine for the top-down arena (negligible occluding geometry).
export class HealthBarLayer {
  private readonly ui: AdvancedDynamicTexture;
  private bars = new Map<string, HealthBar>();

  constructor(scene: Scene) {
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("hpUI", true, scene);
  }

  link(id: string, mesh: Mesh, options: HealthBarOptions): void {
    this.remove(id);
    const track = new Rectangle(`hp-track-${id}`);
    track.widthInPixels = options.trackWidthPx;
    track.heightInPixels = options.trackHeightPx ?? Math.max(6, Math.round(options.trackWidthPx / 8));
    track.thickness = 2;
    track.cornerRadius = options.cornerRadiusPx ?? 0;
    track.color = options.borderColor ?? "rgba(255, 255, 255, 0.55)";
    track.background = options.backgroundColor ?? "rgba(0, 0, 0, 0.65)";
    track.clipChildren = true;
    track.clipContent = true;
    track.isHitTestVisible = false;
    track.isVisible = false;

    const fill = new Rectangle(`hp-fill-${id}`);
    fill.width = "100%";
    fill.height = "100%";
    fill.thickness = 0;
    fill.cornerRadius = options.cornerRadiusPx ?? 0;
    fill.background = options.color;
    fill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    fill.isHitTestVisible = false;

    track.addControl(fill);
    let label: TextBlock | null = null;
    if (options.showLabel) {
      label = new TextBlock(`bar-label-${id}`);
      label.text = "";
      label.color = "#e8edf7";
      label.fontFamily = "Chakra Petch, Segoe UI, sans-serif";
      label.fontSizeInPixels = options.labelFontSizePx ?? 13;
      label.isHitTestVisible = false;
      track.addControl(label);
    }
    this.ui.addControl(track);
    // linkWithMesh must follow addControl. Negative Y lifts the bar above the mesh origin (GUI Y is
    // screen-down); the configured offsets are already negative.
    track.linkWithMesh(mesh);
    track.linkOffsetYInPixels = options.offsetYPx;

    this.bars.set(id, { track, fill, label, lastPct: -1, lastColor: options.color, lastLabel: "" });
  }

  set(id: string, pct: number, visible: boolean, label = "", color?: string): void {
    const bar = this.bars.get(id);
    if (!bar) return;
    bar.track.isVisible = visible;
    if (!visible) return;
    const clamped = clamp01(Number.isFinite(pct) ? pct : 0);
    if (clamped !== bar.lastPct) {
      bar.fill.width = `${clamped * 100}%`;
      bar.lastPct = clamped;
    }
    if (color && color !== bar.lastColor) {
      bar.fill.background = color;
      bar.lastColor = color;
    }
    if (bar.label && label !== bar.lastLabel) {
      bar.label.text = label;
      bar.lastLabel = label;
    }
  }

  remove(id: string): void {
    const bar = this.bars.get(id);
    if (!bar) return;
    this.ui.removeControl(bar.track);
    bar.track.dispose();
    this.bars.delete(id);
  }

  dispose(): void {
    this.ui.dispose();
    this.bars.clear();
  }
}
