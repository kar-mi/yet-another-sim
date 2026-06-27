// Per-pull frame relay + tick loop. Owns the authoritative input log and the wall-clock stepping
// that drives it: each tick it asks Session to build a merged-intent Frame (Session owns slots /
// intents / bots-invincible), appends it to the log, batches it, and flushes batches to clients.
// The server never runs the engine `tick()` — clients do; this only relays input frames.
//
// Extracted from Session: this knows nothing about lobby/world state. Session injects buildFrame
// (frame assembly), onFrames (broadcast + metrics), onCeiling (defensive end), and isRunning.

import type { Frame } from "@shared/protocol";
import { metrics } from "./metrics";
import type { SessionLog } from "./sessionRaid";

const DT = 1 / 60;
const TICK_MS = 1000 / 60;
// Hard cap on sim time caught up in a single loop. We process ALL ticks due since the last loop
// (never discarding accumulated time — dropped ticks make every client's authoritative position lag
// real input, which then never reconciles to client prediction). This cap only bounds a pathological
// gap (process suspension / debugger pause) so one callback can't emit a runaway burst.
const MAX_CATCHUP_SECONDS = 0.25;
// Poll finer than TICK_MS so due frames emit near ideal 60Hz time, reducing client buffer jitter.
const POLL_MS = 5;
// Defensive ceiling so a room whose host never sends `simEnded` can't relay idle frames forever.
// Generous slack past the raid duration; the host normally ends the pull near `duration`.
const PULL_GRACE_SECONDS = 30;

let maxFrameBroadcastBatch = 0;

type TickHandle = ReturnType<typeof setInterval>;

export interface FrameRelayOptions {
  now: () => number;
  autoTick: boolean;
  sessionLog: () => SessionLog | null;
  buildFrame: () => Frame;
  onFrames: (startTick: number, frames: Frame[]) => void;
  onCeiling: () => void;
  isRunning: () => boolean;
}

export class FrameRelay {
  // Authoritative input log: one merged-intent Frame per simulated tick since the pull started.
  // `inputLog.length` is the current tick. Sent in full on late join / resync and replayed by the
  // client. Bounded by pull length (~18k frames / 5min at 60Hz, MBs of JSON).
  readonly inputLog: Frame[] = [];

  private frameBatch: Frame[] = [];
  private tickHandle: TickHandle | null = null;
  private tickAccumulator = 0;
  private lastTickAt = 0;
  private maxPullTicks = Infinity;

  private readonly now: () => number;
  private readonly autoTick: boolean;
  private readonly sessionLog: () => SessionLog | null;
  private readonly buildFrame: () => Frame;
  private readonly onFrames: (startTick: number, frames: Frame[]) => void;
  private readonly onCeiling: () => void;
  private readonly isRunning: () => boolean;

  constructor(options: FrameRelayOptions) {
    this.now = options.now;
    this.autoTick = options.autoTick;
    this.sessionLog = options.sessionLog;
    this.buildFrame = options.buildFrame;
    this.onFrames = options.onFrames;
    this.onCeiling = options.onCeiling;
    this.isRunning = options.isRunning;
  }

  get tick(): number {
    return this.inputLog.length;
  }

  // Reset per-pull relay state. Called whenever a fresh tick-0 world is built.
  reset(durationSeconds: number): void {
    this.inputLog.length = 0;
    this.frameBatch = [];
    this.tickAccumulator = 0;
    this.maxPullTicks = Math.ceil((durationSeconds + PULL_GRACE_SECONDS) / DT);
  }

  // Stamp the merged human intents for this tick, append to the input log, and (unless batching)
  // broadcast immediately.
  produceFrame(): void {
    const frame = this.buildFrame();
    this.inputLog.push(frame);
    this.frameBatch.push(frame);
    this.sessionLog()?.frame(this.inputLog.length - 1, [frame]);
    if (this.inputLog.length >= this.maxPullTicks) this.onCeiling();
  }

  flush(): void {
    if (this.frameBatch.length === 0) return;
    const startTick = this.inputLog.length - this.frameBatch.length;
    const batchSize = this.frameBatch.length;
    this.onFrames(startTick, this.frameBatch);
    metrics.framesBroadcast.inc(batchSize);
    metrics.frameBroadcastBatchLast.set(batchSize);
    if (batchSize > maxFrameBroadcastBatch) {
      maxFrameBroadcastBatch = batchSize;
      metrics.frameBroadcastBatchMax.set(batchSize);
    }
    if (batchSize > 1) metrics.relayCatchupBatchesTotal.inc();
    this.frameBatch = [];
  }

  start(): void {
    if (!this.autoTick) return;
    this.lastTickAt = this.now();
    this.tickAccumulator = 0;
    this.stop();
    this.tickHandle = setInterval(() => this.runDueTicks(), POLL_MS);
  }

  stop(): void {
    if (!this.tickHandle) return;
    clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  private runDueTicks(): void {
    if (!this.isRunning()) return;

    const now = this.now();
    const rawElapsed = (now - this.lastTickAt) / 1000;
    const elapsed = Math.min(rawElapsed, MAX_CATCHUP_SECONDS);
    if (rawElapsed > MAX_CATCHUP_SECONDS) metrics.catchupExhausted.inc(); // pathological gap: time clamped
    metrics.relayTickDriftSeconds.set(Math.max(0, elapsed - DT));
    this.lastTickAt = now;
    this.tickAccumulator += Math.max(0, elapsed);

    // Produce every tick due since the last loop (bounded only by the elapsed clamp above), so no sim
    // time is ever dropped and the authoritative position tracks real input exactly.
    while (this.tickAccumulator >= DT && this.isRunning()) {
      this.produceFrame();
      this.tickAccumulator -= DT;
    }

    // Relay everything produced this loop in one message (≈1 frame per call at 60Hz; more only when
    // catching up). Tiny per-tick frames already keep egress to a couple KB/s per client.
    this.flush();
  }
}
