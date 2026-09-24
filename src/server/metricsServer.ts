import { timingSafeEqual } from "node:crypto";
import { logger } from "@shared/logger";
import { metrics, registry } from "./metrics";

interface MetricsSources {
  sessionsActive: () => number;
  clientsConnected: () => number;
  sessionsCapacity: number;
}

function authorized(req: Request, token: string): boolean {
  const provided = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function startRuntimeCollectors(): void {
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    metrics.eventLoopLagSeconds.set(Math.max(0, now - last - 1000) / 1000);
    last = now;
  }, 1000).unref();
}

export function startMetricsServer(sources: MetricsSources): void {
  const token = Bun.env.METRICS_TOKEN;
  if (!token) {
    logger.warn("metrics", "METRICS_TOKEN not set; metrics endpoint disabled");
    return;
  }

  const port = Number(Bun.env.METRICS_PORT || 9100);
  const hostname = Bun.env.METRICS_HOST || "0.0.0.0";
  metrics.sessionsCapacity.set(sources.sessionsCapacity);
  startRuntimeCollectors();

  const server = Bun.serve({
    port,
    hostname,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/metrics") return new Response("Not found", { status: 404 });
      if (!authorized(req, token)) {
        return new Response("Unauthorized", { status: 401, headers: { "www-authenticate": "Bearer" } });
      }

      metrics.sessionsActive.set(sources.sessionsActive());
      metrics.clientsConnected.set(sources.clientsConnected());
      metrics.residentMemoryBytes.set(process.memoryUsage().rss);

      return new Response(registry.render(), {
        headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
      });
    },
  });

  logger.info("metrics", "metrics endpoint listening", { port: server.port, hostname });
}
