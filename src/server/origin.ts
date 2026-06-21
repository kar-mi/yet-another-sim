const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!HTTP_PROTOCOLS.has(url.protocol) || url.origin === "null") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function parseAllowedOrigins(raw: string | undefined): Set<string> {
  const origins = new Set<string>();
  if (!raw) return origins;
  for (const value of raw.split(",").map(value => value.trim()).filter(Boolean)) {
    const origin = normalizeOrigin(value);
    if (!origin) throw new Error(`ALLOWED_ORIGINS contains an invalid HTTP(S) origin: ${value}`);
    origins.add(origin);
  }
  return origins;
}

export function isOriginAllowed(
  originHeader: string | null,
  requestUrl: string,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (!originHeader) return false;
  const origin = normalizeOrigin(originHeader);
  const requestOrigin = normalizeOrigin(requestUrl);
  if (!origin || !requestOrigin) return false;
  return origin === requestOrigin || allowedOrigins.has(origin);
}
