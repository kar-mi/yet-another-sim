import type { Player, World, WaymarkId } from "@shared/types";
import { minimapProjection, projectMinimap, type MinimapProjection } from "./minimapProjection";

const COLORS: Record<WaymarkId, string> = {
  A: "#f24040", "1": "#f24040",
  B: "#f2cc33", "2": "#f2cc33",
  C: "#4d8cf2", "3": "#4d8cf2",
  D: "#b359e6", "4": "#b359e6",
};

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

export class Minimap {
  readonly element = document.createElement("div");
  private readonly arena = svg("g", { class: "yas-minimap-arena" });
  private readonly marks = svg("g", { class: "yas-minimap-marks" });
  private readonly others = svg("g");
  private readonly dots = new Map<string, SVGCircleElement>();
  private readonly player = svg("path", { class: "yas-minimap-player", d: "M 0 -4.5 L 3.25 4 L 0 2 L -3.25 4 Z", display: "none" });
  private arenaKey = "";
  private marksKey = "";
  private projection: MinimapProjection | null = null;

  constructor() {
    this.element.id = "yas-minimap";
    const map = svg("svg", { viewBox: "0 0 200 200", role: "img", "aria-label": "Minimap: arena, waymarks, players, and current POV" });
    const content = svg("g", { class: "yas-minimap-content" });
    content.append(this.arena, this.marks, this.others, this.player);
    map.append(content);
    for (const [label, x, y] of [["N", 100, 12], ["E", 188, 100], ["S", 100, 188], ["W", 12, 100]] as const) {
      const text = svg("text", { x, y, class: "yas-minimap-compass" });
      text.textContent = label;
      map.append(text);
    }
    this.element.append(map);
  }

  sync(world: World, povPlayer: Player | undefined): void {
    const arenaKey = JSON.stringify(world.arena.zones);
    const arenaChanged = arenaKey !== this.arenaKey;
    if (arenaChanged) {
      this.arenaKey = arenaKey;
      this.projection = minimapProjection(world.arena.zones);
      this.arena.replaceChildren();
      if (this.projection) {
        const projection = this.projection;
        for (const zone of world.arena.zones) {
          if (zone.kind === "polygon") {
            this.arena.append(svg("polygon", { points: zone.vertices.map(vertex => {
              const p = projectMinimap(vertex, projection);
              return `${p.x},${p.y}`;
            }).join(" ") }));
          } else {
            const p = projectMinimap(zone.center, projection);
            this.arena.append(zone.kind === "circle"
              ? svg("circle", { cx: p.x, cy: p.y, r: zone.radius * projection.scale })
              : svg("rect", {
                x: p.x - zone.width * projection.scale / 2,
                y: p.y - zone.height * projection.scale / 2,
                width: zone.width * projection.scale,
                height: zone.height * projection.scale,
              }));
          }
        }
      }
    }
    const marksKey = JSON.stringify(world.waymarks);
    if (arenaChanged || marksKey !== this.marksKey) {
      this.marksKey = marksKey;
      this.marks.replaceChildren();
      if (this.projection) for (const mark of world.waymarks) {
        const p = projectMinimap(mark.pos, this.projection);
        const group = svg("g", { transform: `translate(${p.x} ${p.y})`, color: COLORS[mark.mark] });
        group.append(mark.mark >= "A"
          ? svg("circle", { r: 7 })
          : svg("rect", { x: -7, y: -7, width: 14, height: 14, rx: 1 }));
        const label = svg("text", { x: 0, y: 0 });
        label.textContent = mark.mark;
        group.append(label);
        this.marks.append(group);
      }
    }
    const visibleIds = new Set<string>();
    if (this.projection) for (const other of world.players) {
      if (other.id === povPlayer?.id) continue;
      visibleIds.add(other.id);
      let dot = this.dots.get(other.id);
      if (!dot) {
        dot = svg("circle", { r: 2.5 });
        this.dots.set(other.id, dot);
        this.others.append(dot);
      }
      const p = projectMinimap(other.pos, this.projection);
      dot.setAttribute("class", `yas-minimap-dot yas-minimap-dot--${other.role}`);
      dot.setAttribute("cx", String(p.x));
      dot.setAttribute("cy", String(p.y));
      dot.setAttribute("opacity", other.alive ? "1" : "0.45");
    }
    for (const [id, dot] of this.dots) {
      if (visibleIds.has(id)) continue;
      dot.remove();
      this.dots.delete(id);
    }
    this.player.setAttribute("display", povPlayer && this.projection ? "" : "none");
    if (povPlayer && this.projection) {
      const p = projectMinimap(povPlayer.pos, this.projection);
      this.player.setAttribute("transform", `translate(${p.x} ${p.y}) rotate(${povPlayer.facing * 180 / Math.PI})`);
      this.player.setAttribute("opacity", povPlayer.alive ? "1" : "0.45");
    }
  }

  dispose(): void { this.element.remove(); }
}
