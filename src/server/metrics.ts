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

class Histogram implements Metric {
  // `counts[i]` is the cumulative number of observations <= buckets[i], so it
  // maps directly onto Prometheus's `_bucket{le=...}` lines without extra work.
  private readonly counts: number[];
  private sum = 0;
  private count = 0;
  constructor(readonly name: string, readonly help: string, private readonly buckets: number[]) {
    this.counts = new Array(buckets.length).fill(0);
  }
  observe(v: number): void {
    this.sum += v;
    this.count++;
    for (let i = 0; i < this.buckets.length; i++) {
      if (v <= this.buckets[i]!) this.counts[i]!++;
    }
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (let i = 0; i < this.buckets.length; i++) {
      lines.push(`${this.name}_bucket{le="${this.buckets[i]}"} ${this.counts[i]}`);
    }
    lines.push(`${this.name}_bucket{le="+Inf"} ${this.count}`);
    lines.push(`${this.name}_sum ${this.sum}`);
    lines.push(`${this.name}_count ${this.count}`);
    return lines.join("\n");
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
  // Sim health — the signals that matter most for a fixed-step game loop.
  tickDuration: registry.register(
    new Histogram(
      "sim_tick_duration_seconds",
      "Wall time spent in a single engine tick().",
      [0.0005, 0.001, 0.002, 0.005, 0.01, 0.0167, 0.02, 0.05],
    ),
  ),
  catchupExhausted: registry.register(
    new Counter(
      "sim_catchup_exhausted_total",
      "Times a session hit MAX_CATCH_UP_STEPS and dropped accumulated sim time.",
    ),
  ),
  sessionsActive: registry.register(new Gauge("sim_sessions_active", "Sessions currently in the manager.")),
  clientsConnected: registry.register(new Gauge("sim_clients_connected", "Open WebSocket clients.")),

  // Network.
  wsMessagesTotal: registry.register(new Counter("ws_messages_received_total", "WebSocket messages received.")),
  wsInvalidTotal: registry.register(new Counter("ws_invalid_messages_total", "WebSocket messages that failed validation/JSON parse.")),

  // Process runtime (sampled by the metrics server).
  residentMemoryBytes: registry.register(new Gauge("process_resident_memory_bytes", "Resident set size in bytes.")),
  eventLoopLagSeconds: registry.register(new Gauge("process_event_loop_lag_seconds", "Observed event-loop scheduling delay.")),
};
