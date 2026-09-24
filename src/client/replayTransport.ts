import { TICK_MS } from "@shared/constants";
import { EMPTY_RAID_ID, type ClientMessage, type Frame, type ServerMessage } from "@model/protocol";
import type { World } from "@model/types";
import type { Transport } from "./net";

const MAX_CATCHUP_FRAMES = 240;

export class ReplayTransport implements Transport {
  private readonly participantId = crypto.randomUUID();
  private handler: (message: ServerMessage) => void = () => {};
  private cursor = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private playing = false;
  private playAnchorWall = 0;
  private playAnchorCursor = 0;

  constructor(private readonly replay: { raidId: string; world: World; frames: Frame[] }) {}

  open(): Promise<void> {
    return Promise.resolve();
  }

  send(message: ClientMessage): boolean {
    if (message.type === "join") {
      this.handler({ type: "joined", participantId: this.participantId });
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

  onDisconnect(_cb: () => void): void {}

  close(): void {
    this.pause();
  }

  duration(): number {
    return this.replay.frames.length;
  }

  currentTick(): number {
    return this.cursor;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  sync(view: { playing: boolean; tick: number }): void {
    const tick = Math.max(0, Math.min(this.replay.frames.length, Math.floor(view.tick)));
    if (tick !== this.cursor) this.seek(tick);
    if (view.playing) this.play();
    else if (this.playing) this.pause();
  }

  play(): void {
    if (this.playing || this.cursor >= this.replay.frames.length) return;
    this.playing = true;
    this.playAnchorWall = performance.now();
    this.playAnchorCursor = this.cursor;
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
    this.handler({ type: "started", pull: 0, world: this.replay.world, baseTick: 0, yourPlayerId: null, tick, frames: this.replay.frames.slice(0, tick) });
  }

  private emitPlayback(state: "playing" | "paused"): void {
    this.handler({ type: "playback", state, phase: "raid", raidId: this.replay.raidId || EMPTY_RAID_ID, hostParticipantId: this.participantId, rngDecisions: [] });
  }

  private deliver(): void {
    if (this.cursor >= this.replay.frames.length) {
      this.pause();
      return;
    }
    const elapsedTicks = Math.floor((performance.now() - this.playAnchorWall) / TICK_MS);
    let target = Math.min(this.replay.frames.length, this.playAnchorCursor + elapsedTicks);
    if (target <= this.cursor) return;
    if (target - this.cursor > MAX_CATCHUP_FRAMES) {
      target = this.cursor + MAX_CATCHUP_FRAMES;
      this.playAnchorWall = performance.now();
      this.playAnchorCursor = target;
    }
    this.handler({ type: "frames", startTick: this.cursor, frames: this.replay.frames.slice(this.cursor, target) });
    this.cursor = target;
    if (this.cursor >= this.replay.frames.length) this.pause();
  }
}
