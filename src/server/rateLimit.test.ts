import { describe, expect, test } from "bun:test";
import { ConnectionCounter, clientIpFor, createMessageRateLimiter } from "./rateLimit";

describe("clientIpFor", () => {
  test("uses the first X-Forwarded-For entry", () => {
    expect(clientIpFor("203.0.113.7, 10.0.0.1", "127.0.0.1")).toBe("203.0.113.7");
  });

  test("trims whitespace around the forwarded IP", () => {
    expect(clientIpFor("  203.0.113.7  ", "127.0.0.1")).toBe("203.0.113.7");
  });

  test("falls back to the socket address when no header is present", () => {
    expect(clientIpFor(null, "198.51.100.4")).toBe("198.51.100.4");
  });

  test("returns 'unknown' when neither is available", () => {
    expect(clientIpFor(null, undefined)).toBe("unknown");
  });
});

describe("ConnectionCounter", () => {
  test("allows up to the cap then rejects", () => {
    const counter = new ConnectionCounter(2);
    expect(counter.tryAcquire("ip")).toBeTrue();
    expect(counter.tryAcquire("ip")).toBeTrue();
    expect(counter.tryAcquire("ip")).toBeFalse();
  });

  test("release frees a slot", () => {
    const counter = new ConnectionCounter(1);
    expect(counter.tryAcquire("ip")).toBeTrue();
    expect(counter.tryAcquire("ip")).toBeFalse();
    counter.release("ip");
    expect(counter.tryAcquire("ip")).toBeTrue();
  });

  test("counts each IP independently", () => {
    const counter = new ConnectionCounter(1);
    expect(counter.tryAcquire("a")).toBeTrue();
    expect(counter.tryAcquire("b")).toBeTrue();
    expect(counter.tryAcquire("a")).toBeFalse();
  });

  test("release of an unknown IP is a no-op", () => {
    const counter = new ConnectionCounter(1);
    counter.release("missing");
    expect(counter.tryAcquire("missing")).toBeTrue();
  });
});

describe("createMessageRateLimiter", () => {
  test("allows up to the cap within a window then drops", () => {
    const limiter = createMessageRateLimiter(3);
    expect(limiter.allow(1000)).toBeTrue();
    expect(limiter.allow(1100)).toBeTrue();
    expect(limiter.allow(1200)).toBeTrue();
    expect(limiter.allow(1300)).toBeFalse();
  });

  test("resets after the 1-second window elapses", () => {
    const limiter = createMessageRateLimiter(1);
    expect(limiter.allow(1000)).toBeTrue();
    expect(limiter.allow(1500)).toBeFalse();
    expect(limiter.allow(2000)).toBeTrue();
  });
});
