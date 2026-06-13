// Per-pull desync detection over a bounded per-tick hash window. The host's reported world hash is
// canonical for a tick (it has end-of-pull authority); any other client reporting a different hash
// for that tick has diverged and is resynced. Extracted from Session: this owns only the hash
// bookkeeping and rate-cap; the actual resync (replaying the input log to the offender) stays in
// Session via the onDesync callback, since it needs lobby/world state.

import { logger } from "@shared/logger";
import { metrics } from "./metrics";

// Bound the per-tick desync-hash table so it can't grow without limit on a long pull.
const MAX_HASH_WINDOW = 64;
// Clients report a hash every ~5s; drop anything more frequent so a client can't spam the relay.
const MIN_HASH_REPORT_MS = 1000;

export interface DesyncTrackerOptions {
  sessionId: string;
  now: () => number;
  onDesync: (clientId: string) => void;
}

export class DesyncTracker {
  // Canonical world hash per tick = the host's hash (it has end-of-pull authority); a mismatch from
  // any other client is a desync. Trusting the host avoids "resyncing" honest clients toward a
  // desynced one when that client happens to report first.
  private readonly canonicalHashes = new Map<number, number>();
  // Non-host hash reports awaiting the host's canonical hash for the same tick (the host's report
  // may arrive later); verified and dropped once the host's hash lands.
  private readonly pendingHashes = new Map<number, Map<string, number>>();
  // Last time each client's hash report was accepted, for rate-capping.
  private readonly lastHashReportAt = new Map<string, number>();

  private readonly sessionId: string;
  private readonly now: () => number;
  private readonly onDesync: (clientId: string) => void;

  constructor(options: DesyncTrackerOptions) {
    this.sessionId = options.sessionId;
    this.now = options.now;
    this.onDesync = options.onDesync;
  }

  // Record a client's hash for a tick. The first hash seen for a tick is canonical; a later, different
  // hash for the same tick means that client's floats diverged — flag it and resync the offender.
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

  // Reset per-pull state. Called whenever a fresh tick-0 world is built.
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
    // Pending reports for a tick the host never canonicalized (e.g. its report was rate-dropped)
    // would otherwise leak; bound them the same way.
    while (this.pendingHashes.size > MAX_HASH_WINDOW) {
      this.pendingHashes.delete(Math.min(...this.pendingHashes.keys()));
    }
  }
}
