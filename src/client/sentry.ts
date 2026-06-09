import * as Sentry from "@sentry/browser";

declare const __SENTRY_CLIENT_DSN__: string | undefined;
declare const __SENTRY_ENABLED__: string | undefined;
declare const __SENTRY_ENVIRONMENT__: string | undefined;
declare const __SENTRY_RELEASE__: string | undefined;
declare const __SENTRY_CLIENT_TRACES_SAMPLE_RATE__: string | undefined;

type SessionContext = {
  sessionId?: string;
  raidId?: string;
  playerId?: string | null;
  observing?: boolean;
};

function readDefine(name: string): string {
  switch (name) {
    case "__SENTRY_CLIENT_DSN__":
      return typeof __SENTRY_CLIENT_DSN__ === "string" ? __SENTRY_CLIENT_DSN__ : "";
    case "__SENTRY_ENABLED__":
      return typeof __SENTRY_ENABLED__ === "string" ? __SENTRY_ENABLED__ : "";
    case "__SENTRY_ENVIRONMENT__":
      return typeof __SENTRY_ENVIRONMENT__ === "string" ? __SENTRY_ENVIRONMENT__ : "";
    case "__SENTRY_RELEASE__":
      return typeof __SENTRY_RELEASE__ === "string" ? __SENTRY_RELEASE__ : "";
    case "__SENTRY_CLIENT_TRACES_SAMPLE_RATE__":
      return typeof __SENTRY_CLIENT_TRACES_SAMPLE_RATE__ === "string" ? __SENTRY_CLIENT_TRACES_SAMPLE_RATE__ : "";
    default:
      return "";
  }
}

function parseSampleRate(value: string): number {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

function isEnabled(value: string): boolean {
  return value !== "false" && value !== "0";
}

let initialized = false;

export function initClientSentry(): void {
  const dsn = readDefine("__SENTRY_CLIENT_DSN__");
  if (!dsn || initialized || !isEnabled(readDefine("__SENTRY_ENABLED__"))) return;

  const tracesSampleRate = parseSampleRate(readDefine("__SENTRY_CLIENT_TRACES_SAMPLE_RATE__"));
  Sentry.init({
    dsn,
    environment: readDefine("__SENTRY_ENVIRONMENT__") || "development",
    release: readDefine("__SENTRY_RELEASE__") || undefined,
    integrations: tracesSampleRate > 0 ? [Sentry.browserTracingIntegration()] : undefined,
    sendDefaultPii: false,
    tracesSampleRate,
  });
  initialized = true;
}

export function addClientBreadcrumb(category: string, message: string, data?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.addBreadcrumb({
    category,
    message,
    level: "info",
    data,
  });
}

export function captureClientException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.withScope(scope => {
    if (context) scope.setContext("yas", context);
    Sentry.captureException(error);
  });
}

export function setSentryClientId(clientId: string): void {
  if (!initialized) return;
  Sentry.setContext("client", { clientId });
}

export function setSentrySessionContext(context: SessionContext): void {
  if (!initialized) return;
  if (context.raidId) Sentry.setTag("raid_id", context.raidId);
  Sentry.setContext("session", context);
}
