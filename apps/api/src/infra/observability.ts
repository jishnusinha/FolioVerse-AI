import { context, metrics, propagation, SpanKind, SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';

/**
 * Tracing and metrics helpers. Every call is a no-op until telemetry.ts registers providers
 * (only when OTEL_EXPORTER_OTLP_ENDPOINT is set), so tests and local runs are unaffected.
 * Attributes carry ids and enums only, never prompts, answers or source text.
 */
export const FV_ATTR = {
  workspaceId: 'fv.workspace_id',
  runId: 'fv.run_id',
  graph: 'fv.graph',
  node: 'fv.node',
  jobId: 'fv.job_id',
} as const;

const tracer = () => trace.getTracer('folioverse-api');

/** W3C trace-context headers for the active span (empty when tracing is off). */
export function traceHeaders(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

/** Adds the active trace context to a job payload so the worker continues the same trace. */
export function withTraceContext<T>(data: T): T {
  const h = traceHeaders();
  if (!h.traceparent || !data || typeof data !== 'object' || Array.isArray(data)) return data;
  return { ...data, traceparent: h.traceparent, ...(h.tracestate ? { tracestate: h.tracestate } : {}) };
}

export function annotate(attrs: Attributes) {
  trace.getActiveSpan()?.setAttributes(attrs);
}

/** Housekeeping jobs that repeat every few seconds; tracing them would drown real work. */
const UNTRACED_JOBS = new Set(['reap', 'sweep']);

/** Runs a BullMQ job inside a CONSUMER span parented to the trace that enqueued it. */
export function inJobSpan<T>(queue: string, job: { id?: string; name: string; data?: any }, fn: () => Promise<T>): Promise<T> {
  if (UNTRACED_JOBS.has(job.name)) return fn();
  const data = job.data ?? {};
  const parent =
    typeof data.traceparent === 'string'
      ? propagation.extract(context.active(), { traceparent: data.traceparent, ...(data.tracestate ? { tracestate: data.tracestate } : {}) })
      : context.active();
  const attributes: Attributes = { 'messaging.system': 'bullmq', 'messaging.destination.name': queue, 'messaging.operation': 'process', [FV_ATTR.jobId]: job.id ?? '' };
  if (typeof data.workspaceId === 'string') attributes[FV_ATTR.workspaceId] = data.workspaceId;
  if (typeof data.runId === 'string') attributes[FV_ATTR.runId] = data.runId;
  return tracer().startActiveSpan(`${queue} ${job.name}`, { kind: SpanKind.CONSUMER, attributes }, parent, async (span) => {
    try {
      return await fn();
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String((e as Error)?.message ?? e).slice(0, 200) });
      throw e;
    } finally {
      span.end();
    }
  });
}

function createInstruments() {
  const m = metrics.getMeter('folioverse-api');
  return {
    runs: m.createCounter('fv.runs', { description: 'AI runs that reached a terminal state, by graph and status' }),
    runDuration: m.createHistogram('fv.run.duration', { unit: 's', description: 'Run wall time from claim to terminal state' }),
    ingestionJobs: m.createCounter('fv.ingestion.jobs', { description: 'Ingestion jobs that reached a terminal state' }),
    ingestionDuration: m.createHistogram('fv.ingestion.duration', { unit: 's', description: 'Ingestion job wall time' }),
    ledgerEntries: m.createCounter('fv.ledger.entries', { description: 'Cost ledger entries written' }),
    ledgerChargedUsd: m.createCounter('fv.ledger.charged_usd', { description: 'USD written to FINAL ledger entries' }),
    budgetRejections: m.createCounter('fv.budget.rejections', { description: 'Runs rejected before any model call by a budget' }),
    sseConnections: m.createUpDownCounter('fv.sse.connections', { description: 'Open SSE streams' }),
    sseEvents: m.createCounter('fv.sse.events', { description: 'Events written to SSE streams' }),
  };
}

let instruments: ReturnType<typeof createInstruments> | null = null;

/** Metric instruments, created lazily so they bind to the provider telemetry.ts registered. */
export function fvMetrics() {
  instruments ??= createInstruments();
  return instruments;
}

/** Registers an observable gauge; the callback runs on each export (never in tests). */
export function observeGauge(name: string, description: string, read: () => Promise<Record<string, number>>, label: string) {
  metrics
    .getMeter('folioverse-api')
    .createObservableGauge(name, { description })
    .addCallback(async (r) => {
      const values = await read().catch(() => ({}) as Record<string, number>);
      for (const [k, v] of Object.entries(values)) r.observe(v, { [label]: k });
    });
}

let flushTelemetry: (() => Promise<void>) | null = null;

export function onTelemetryShutdown(fn: () => Promise<void>) {
  flushTelemetry = fn;
}

export async function shutdownTelemetry() {
  await flushTelemetry?.();
}

export function secondsSince(d: Date | null | undefined) {
  return d ? Math.max(0, (Date.now() - d.getTime()) / 1000) : 0;
}
