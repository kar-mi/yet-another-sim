import * as Sentry from "@sentry/bun";

function parseSampleRate(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

function isEnabled(value: string | undefined): boolean {
  return value !== "false" && value !== "0";
}

const dsn = Bun.env.SENTRY_DSN;
const tracesSampleRate = parseSampleRate(Bun.env.SENTRY_TRACES_SAMPLE_RATE);

if (dsn && isEnabled(Bun.env.SENTRY_ENABLED)) {
  Sentry.init({
    dsn,
    environment: Bun.env.SENTRY_ENVIRONMENT || Bun.env.NODE_ENV || "development",
    release: Bun.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate,
  });
}

export function addServerBreadcrumb(category: string, message: string, data?: Record<string, unknown>): void {
  if (!Sentry.isEnabled()) return;
  Sentry.addBreadcrumb({
    category,
    message,
    level: "info",
    data,
  });
}

export function captureServerException(error: unknown, context?: Record<string, unknown>): void {
  if (!Sentry.isEnabled()) return;
  Sentry.withScope(scope => {
    if (context) scope.setContext("yas", context);
    Sentry.captureException(error);
  });
}
