import { INVALID_SPAN_CONTEXT, SpanStatusCode, trace, type Span, type SpanAttributeValue, type SpanAttributes } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BasicTracerProvider, BatchSpanProcessor, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";
import { logger } from "./logger";

const SERVICE_NAME = "yet-another-sim";
const INSTRUMENTATION_NAME = "yet-another-sim-server";

function isEnabled(value: string | undefined): boolean {
  return value !== "false" && value !== "0";
}

function isExplicitlyEnabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function parseSampleRate(value: string | undefined): number {
  if (!value) return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(1, Math.max(0, parsed));
}

function tracesEndpoint(): string {
  const traces = Bun.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (traces) return traces;

  const base = Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  return base ? `${base.replace(/\/+$/, "")}/v1/traces` : "";
}

function normalizeAttribute(value: unknown): SpanAttributeValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  if (Array.isArray(value)) return value.map(item => String(item));

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toSpanAttributes(input?: Record<string, unknown>, prefix = "yas."): SpanAttributes {
  const attributes: SpanAttributes = {};
  if (!input) return attributes;

  for (const [key, value] of Object.entries(input)) {
    const normalized = normalizeAttribute(value);
    if (normalized !== undefined) attributes[`${prefix}${key}`] = normalized;
  }
  return attributes;
}

const endpoint = tracesEndpoint();
const provider = endpoint && isEnabled(Bun.env.OTEL_ENABLED)
  ? new BasicTracerProvider({
      resource: resourceFromAttributes({
        "service.name": Bun.env.OTEL_SERVICE_NAME || SERVICE_NAME,
        "deployment.environment": Bun.env.OTEL_ENVIRONMENT || Bun.env.ENVIRONMENT || Bun.env.NODE_ENV || "development",
      }),
      sampler: new TraceIdRatioBasedSampler(parseSampleRate(Bun.env.OTEL_TRACES_SAMPLE_RATE)),
      spanProcessors: [
        new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint }), {
          scheduledDelayMillis: 1000,
        }),
      ],
    })
  : null;

if (provider) {
  trace.setGlobalTracerProvider(provider);
  logger.info("otel", "OTel traces enabled", { endpoint });
} else if (isExplicitlyEnabled(Bun.env.OTEL_ENABLED) && !endpoint) {
  logger.warn("otel", "OTel traces disabled; OTLP traces endpoint not set");
}

export const otelEnabled = provider !== null;
const tracer = trace.getTracer(INSTRUMENTATION_NAME);
// Non-recording span handed to callers when tracing is off, so the hot path skips span creation and
// attribute marshalling entirely (this runs per inbound WS message).
const NOOP_SPAN = trace.wrapSpanContext(INVALID_SPAN_CONTEXT);

export async function withServerSpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  if (!otelEnabled) return fn(NOOP_SPAN);
  const span = tracer.startSpan(name, { attributes: toSpanAttributes(attributes) });
  try {
    return await fn(span);
  } catch (error) {
    recordServerException(error, attributes, span);
    throw error;
  } finally {
    span.end();
  }
}

export function addServerTraceEvent(category: string, message: string, data?: Record<string, unknown>): void {
  if (!otelEnabled) return;
  const span = tracer.startSpan("server.event", {
    attributes: {
      "event.category": category,
      "event.name": message,
      ...toSpanAttributes(data),
    },
  });
  span.end();
}

export function recordServerException(error: unknown, context?: Record<string, unknown>, span?: Span): void {
  if (!otelEnabled) return;

  const target = span ?? tracer.startSpan("server.exception", { attributes: toSpanAttributes(context) });
  if (error instanceof Error || typeof error === "string") {
    target.recordException(error);
  } else {
    target.recordException(String(error));
  }
  target.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
  if (!span) target.end();
}
