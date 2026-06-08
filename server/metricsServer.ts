// Serves /metrics on a SEPARATE port from the game so the exposition endpoint
// is never co-located with public game traffic. Access is gated by a bearer
// token (constant-time compared); if METRICS_TOKEN is unset the endpoint refuses
// to start, so metrics are never exposed unauthenticated by accident.
import { timingSafeEqual } from "node:crypto";
import { logger } from "../src/shared/logger";
import { metrics, registry } from "./metrics";

interface MetricsSources {
  sessionsActive: () => number;
  clientsConnected: () => number;
}

function authorized(req: Request, token: string): boolean {
  const provided = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  // timingSafeEqual requires equal lengths; the length check itself leaks only
  // the token's length, which is not secret.
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

// Samples runtime metrics that only make sense to read periodically. The lag
// gauge measures how late a 1s timer actually fires — the canary for a
// saturated event loop, distinct from per-tick cost.
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
