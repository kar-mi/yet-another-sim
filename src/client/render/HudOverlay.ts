import type { World } from "../../shared/types";

export class HudOverlay {
  private el: HTMLDivElement;

  constructor() {
    this.el = document.createElement("div");
    Object.assign(this.el.style, {
      position: "fixed", top: "12px", left: "12px",
      color: "white", fontFamily: "monospace", fontSize: "18px",
      pointerEvents: "none", whiteSpace: "pre",
      textShadow: "1px 1px 4px black",
    });
    document.body.appendChild(this.el);
  }

  sync(world: World): void {
    const p = world.players[0];
    if (world.status === "cleared") {
      this.el.textContent = "CLEARED!";
      this.el.style.color = "#7fff7f";
    } else if (world.status === "wiped") {
      this.el.textContent = "WIPED";
      this.el.style.color = "#ff6060";
    } else {
      this.el.style.color = "white";
      this.el.textContent = `Time: ${world.time.toFixed(1)}s   HP: ${p?.hp ?? 0}`;
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
