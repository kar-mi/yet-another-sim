import { describe, expect, test } from "bun:test";
import { isOriginAllowed, parseAllowedOrigins } from "./origin";

describe("parseAllowedOrigins", () => {
  test("normalizes comma-separated HTTP origins", () => {
    expect(parseAllowedOrigins(" https://EXAMPLE.com/, http://localhost:80/path ")).toEqual(
      new Set(["https://example.com", "http://localhost"]),
    );
  });

  test("rejects invalid and non-HTTP origins", () => {
    expect(() => parseAllowedOrigins("not a url")).toThrow();
    expect(() => parseAllowedOrigins("file:///tmp/test")).toThrow();
  });
});

describe("isOriginAllowed", () => {
  const allowed = parseAllowedOrigins("https://frontend.example");

  test("allows the same complete origin", () => {
    expect(isOriginAllowed("https://game.example", "https://game.example/socket", allowed)).toBeTrue();
  });

  test("does not treat a different scheme as same-origin", () => {
    expect(isOriginAllowed("http://game.example", "https://game.example/socket", allowed)).toBeFalse();
  });

  test("allows a normalized configured origin", () => {
    expect(isOriginAllowed("https://frontend.example", "https://game.example/socket", allowed)).toBeTrue();
  });

  test("rejects missing, malformed, and foreign origins", () => {
    expect(isOriginAllowed(null, "https://game.example/socket", allowed)).toBeFalse();
    expect(isOriginAllowed("not a url", "https://game.example/socket", allowed)).toBeFalse();
    expect(isOriginAllowed("https://evil.example", "https://game.example/socket", allowed)).toBeFalse();
  });
});
