import { logger } from "@shared/logger";
import { metrics } from "./metrics";

const MAX_HASH_WINDOW = 64;
const MIN_HASH_REPORT_MS = 1000;

export interface DesyncTrackerOptions {
  sessionId: string;
  now: () => number;
  onDesync: (clientId: string) => void;
}

export class DesyncTracker {
  private readonly canonicalHashes = new Map<number, number>();
  private readonly pendingHashes = new Map<number, Map<string, number>>();
  private readonly lastHashReportAt = new Map<string, number>();

  private readonly sessionId: string;
  private readonly now: () => number;
  private readonly onDesync: (clientId: string) => void;

  constructor(options: DesyncTrackerOptions) {
    this.sessionId = options.sessionId;
    this.now = options.now;
    this.onDesync = options.onDesync;
  }

  report(clientId: string, tick: number, hash: number, isHost: boolean): void {
    const now = this.now();
    if (now - (this.lastHashReportAt.get(clientId) ?? -Infinity) < MIN_HASH_REPORT_MS) return;
    this.lastHashReportAt.set(clientId, now);

    if (isHost) {
      this.canonicalHashes.set(tick, hash);
      const pending = this.pendingHashes.get(tick);
      if (pending) {
        for (const [cid, reported] of pending) if (reported !== hash) this.flagDesync(tick, hash, reported, cid);
        this.pendingHashes.delete(tick);
      }
      this.pruneHashWindow();
      return;
    }

    const canonical = this.canonicalHashes.get(tick);
    if (canonical === undefined) {
      let pending = this.pendingHashes.get(tick);
      if (!pending) { pending = new Map(); this.pendingHashes.set(tick, pending); }
      pending.set(clientId, hash);
      this.pruneHashWindow();
      return;
    }
    if (canonical === hash) return;
    this.flagDesync(tick, canonical, hash, clientId);
  }

  reset(): void {
    this.canonicalHashes.clear();
    this.pendingHashes.clear();
    this.lastHashReportAt.clear();
  }

  private flagDesync(tick: number, expected: number, got: number, clientId: string): void {
    metrics.desyncTotal.inc();
    logger.warn("session", "world desync", { session: this.sessionId, tick, expected, got, clientId });
    this.onDesync(clientId);
  }

  private pruneHashWindow(): void {
    while (this.canonicalHashes.size > MAX_HASH_WINDOW) {
      this.canonicalHashes.delete(Math.min(...this.canonicalHashes.keys()));
    }
    while (this.pendingHashes.size > MAX_HASH_WINDOW) {
      this.pendingHashes.delete(Math.min(...this.pendingHashes.keys()));
    }
  }
}
