// Dependency-free Prometheus metrics registry (text exposition format v0.0.4).
// Mirrors logger.ts: a single shared module, no external deps. All series here
// are process-global (no labels), which keeps the renderer trivial.

interface Metric {
  render(): string;
}

class Counter implements Metric {
  private value = 0;
  constructor(readonly name: string, readonly help: string) {}
  inc(n = 1): void {
    this.value += n;
  }
  render(): string {
    return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} counter\n${this.name} ${this.value}`;
  }
}

class Gauge implements Metric {
  private value = 0;
  constructor(readonly name: string, readonly help: string) {}
  set(v: number): void {
    this.value = v;
  }
  render(): string {
    return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} gauge\n${this.name} ${this.value}`;
  }
}


class Registry {
  private readonly metrics: Metric[] = [];
  register<T extends Metric>(metric: T): T {
    this.metrics.push(metric);
    return metric;
  }
  render(): string {
    return this.metrics.map((m) => m.render()).join("\n") + "\n";
  }
}

export const registry = new Registry();

export const metrics = {
  // Relay health — in server-relayed lockstep the server forwards input frames instead of ticking.
  framesBroadcast: registry.register(
    new Counter(
      "sim_frames_broadcast_total",
      "Input frames (one per simulated tick) relayed to clients across all sessions.",
    ),
  ),
  desyncTotal: registry.register(
    new Counter(
      "sim_desync_total",
      "Times a client's world hash diverged from the host's canonical hash for the same tick (a resync was issued).",
    ),
  ),
  catchupExhausted: registry.register(
    new Counter(
      "sim_catchup_exhausted_total",
      "Times a relay loop clamped a pathological elapsed gap (process suspension/debugger) and dropped sim time.",
    ),
  ),
  frameBroadcastBatchLast: registry.register(
    new Gauge(
      "sim_frame_broadcast_batch_last",
      "Frames in the most recent relay broadcast batch.",
    ),
  ),
  frameBroadcastBatchMax: registry.register(
    new Gauge(
      "sim_frame_broadcast_batch_max",
      "Largest relay broadcast batch observed since process start.",
    ),
  ),
  relayCatchupBatchesTotal: registry.register(
    new Counter(
      "sim_relay_catchup_batches_total",
      "Relay broadcasts that contained more than one frame due to catch-up.",
    ),
  ),
  relayTickDriftSeconds: registry.register(
    new Gauge(
      "sim_relay_tick_drift_seconds",
      "Most recent relay loop drift beyond the ideal 60Hz tick cadence.",
    ),
  ),
  sessionsActive: registry.register(new Gauge("sim_sessions_active", "Sessions currently in the manager.")),
  sessionsCapacity: registry.register(new Gauge("sim_sessions_capacity", "Configured maximum sessions per backend (MAX_SESSIONS).")),
  clientsConnected: registry.register(new Gauge("sim_clients_connected", "Open WebSocket clients.")),

  // Network.
  wsMessagesTotal: registry.register(new Counter("ws_messages_received_total", "WebSocket messages received.")),
  wsInvalidTotal: registry.register(new Counter("ws_invalid_messages_total", "WebSocket messages that failed validation/JSON parse.")),
  wsRateLimitedTotal: registry.register(new Counter("ws_rate_limited_messages_total", "Inbound WebSocket messages dropped by the per-connection rate limit.")),

  // Process runtime (sampled by the metrics server).
  residentMemoryBytes: registry.register(new Gauge("process_resident_memory_bytes", "Resident set size in bytes.")),
  eventLoopLagSeconds: registry.register(new Gauge("process_event_loop_lag_seconds", "Observed event-loop scheduling delay.")),
};
