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
