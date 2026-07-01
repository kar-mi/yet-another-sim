import { EMPTY_RAID_ID, type ClientMessage, type Frame, type ServerMessage } from "@shared/protocol";
import type { World } from "@shared/types";
import type { Transport } from "./net";

const TICK_MS = 1000 / 60;

export class ReplayTransport implements Transport {
  private readonly clientId = crypto.randomUUID();
  private handler: (message: ServerMessage) => void = () => {};
  private cursor = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private playing = false;

  constructor(private readonly replay: { raidId: string; world: World; frames: Frame[] }) {}

  open(): Promise<void> {
    return Promise.resolve();
  }

  send(message: ClientMessage): boolean {
    if (message.type === "join") {
      this.handler({ type: "joined", clientId: this.clientId });
      this.emitStarted(0);
      this.emitPlayback("paused");
    } else if (message.type === "play") {
      this.play();
    } else if (message.type === "pause") {
      this.pause();
    } else if (message.type === "restart") {
      this.seek(0);
    }
    return true;
  }

  onMessage(cb: (message: ServerMessage) => void): void {
    this.handler = cb;
  }

  onReconnect(_cb: () => void): void {}

  close(): void {
    this.pause();
  }

  duration(): number {
    return this.replay.frames.length;
  }

  currentTick(): number {
    return this.cursor;
  }

  play(): void {
    if (this.playing || this.cursor >= this.replay.frames.length) return;
    this.playing = true;
    this.emitPlayback("playing");
    this.timer = setInterval(() => this.deliver(), TICK_MS);
  }

  pause(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    this.emitPlayback("paused");
  }

  restart(): void {
    this.seek(0);
  }

  seek(tick: number): void {
    const wasPlaying = this.playing;
    this.pause();
    this.emitStarted(Math.max(0, Math.min(this.replay.frames.length, Math.floor(tick))));
    if (wasPlaying) this.play();
  }

  private emitStarted(tick: number): void {
    this.cursor = tick;
    this.handler({ type: "started", world: this.replay.world, baseTick: 0, yourPlayerId: null, tick, frames: this.replay.frames.slice(0, tick) });
  }

  private emitPlayback(state: "playing" | "paused"): void {
    this.handler({ type: "playback", state, raidId: this.replay.raidId || EMPTY_RAID_ID, hostClientId: this.clientId });
  }

  private deliver(): void {
    if (this.cursor >= this.replay.frames.length) {
      this.pause();
      return;
    }
    this.handler({ type: "frames", startTick: this.cursor, frames: [this.replay.frames[this.cursor]!] });
    this.cursor++;
  }
}
