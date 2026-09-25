import type { World } from "@model/types";
import { dueHints, formatClock } from "../chatModel";
import { formatTime } from "./hudPresentation";
import { el } from "./dom";

const MAX_LINES = 50;

export class ChatBox {
  readonly element = el("div", { id: "yas-chat" });
  private readonly logEl = el("div", { className: "yas-chat-log" });
  private seed: number | null = null;
  private prevTime = -1;

  constructor() {
    this.element.append(el("span", { className: "yas-session-label", textContent: "CHAT" }), this.logEl);
  }

  sync(world: World): void {
    if (world.seed !== this.seed) {
      this.seed = world.seed;
      this.prevTime = -1;
    } else if (world.time < this.prevTime) {
      this.prevTime = world.time;
    }
    for (const hint of dueHints(world.hints ?? [], this.prevTime, world.time)) {
      this.append("yas-chat-hint", formatTime(hint.t), hint.text);
    }
    this.prevTime = world.time;
  }

  addSystem(at: number, text: string): void {
    this.append("yas-chat-system", formatClock(at), text);
  }

  private append(className: string, stamp: string, text: string): void {
    const stick = this.logEl.scrollTop + this.logEl.clientHeight >= this.logEl.scrollHeight - 4;
    this.logEl.append(el("div", { className: `yas-chat-line ${className}` }, [
      el("span", { className: "yas-chat-stamp", textContent: `[${stamp}]` }),
      text,
    ]));
    while (this.logEl.childElementCount > MAX_LINES) this.logEl.firstElementChild!.remove();
    if (stick) this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}
