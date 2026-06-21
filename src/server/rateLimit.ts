// App-side DoS hardening for the public WebSocket endpoint: a per-IP connection cap
// (so one client can't exhaust the room pool) and a per-connection inbound message
// rate cap (so one socket can't flood JSON.parse + Zod parse). Pure logic, no Bun
// globals, so it's unit-testable in isolation (mirrors origin.ts).

// Real client IP. Deployment is always behind Caddy, which sets X-Forwarded-For;
// trust its first entry (the original client), falling back to the socket peer when
// no proxy header is present (direct connections / local dev).
export function clientIpFor(
  xForwardedFor: string | null,
  socketAddress: string | undefined,
): string {
  if (xForwardedFor) {
    const first = xForwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return socketAddress ?? "unknown";
}

// Per-IP open-connection counter. tryAcquire reserves a slot (false when the IP is
// at the cap); release frees one and drops the entry at zero so the map can't grow
// unbounded across churn.
export class ConnectionCounter {
  private readonly counts = new Map<string, number>();
  constructor(private readonly maxPerIp: number) {}

  tryAcquire(ip: string): boolean {
    const current = this.counts.get(ip) ?? 0;
    if (current >= this.maxPerIp) return false;
    this.counts.set(ip, current + 1);
    return true;
  }

  release(ip: string): void {
    const current = this.counts.get(ip);
    if (current === undefined) return;
    if (current <= 1) this.counts.delete(ip);
    else this.counts.set(ip, current - 1);
  }
}

export interface RateLimiter {
  allow(now?: number): boolean;
}

// Fixed 1-second window message-rate limiter, one instance per connection. allow()
// returns false once more than maxPerSec messages arrive within the current window;
// callers drop the over-limit message (rather than disconnect) so a legit burst at a
// high refresh rate doesn't kill the session.
export function createMessageRateLimiter(maxPerSec: number): RateLimiter {
  let windowStart = 0;
  let count = 0;
  return {
    allow(now = Date.now()): boolean {
      if (now - windowStart >= 1000) {
        windowStart = now;
        count = 0;
      }
      count++;
      return count <= maxPerSec;
    },
  };
}
