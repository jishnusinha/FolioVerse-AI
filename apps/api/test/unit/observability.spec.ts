import { context, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { inJobSpan, traceHeaders, withTraceContext } from '../../src/infra/observability';

describe('observability helpers without a registered SDK', () => {
  it('leave job payloads and headers untouched', async () => {
    expect(traceHeaders()).toEqual({});
    const data = { runId: 'r1' };
    expect(withTraceContext(data)).toBe(data);
    await expect(inJobSpan('ai-runs', { id: 'r1', name: 'run', data }, async () => 42)).resolves.toBe(42);
  });
});

describe('observability helpers with tracing on', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

  beforeAll(() => provider.register());
  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
  });
  beforeEach(() => exporter.reset());

  it('carries the enqueuing trace into the worker job span', async () => {
    const tracer = trace.getTracer('test');
    let job: any;
    let parentTraceId = '';
    tracer.startActiveSpan('POST /runs', (span) => {
      parentTraceId = span.spanContext().traceId;
      job = withTraceContext({ runId: 'r1', workspaceId: 'w1' });
      span.end();
    });
    expect(job.traceparent).toMatch(new RegExp(`^00-${parentTraceId}-[0-9a-f]{16}-0[01]$`));

    let headersInJob: Record<string, string> = {};
    await inJobSpan('ai-runs', { id: 'r1', name: 'run', data: job }, async () => {
      headersInJob = traceHeaders();
    });
    const consumer = exporter.getFinishedSpans().find((s) => s.name === 'ai-runs run');
    expect(consumer?.spanContext().traceId).toBe(parentTraceId);
    expect(consumer?.attributes).toMatchObject({ 'fv.run_id': 'r1', 'fv.workspace_id': 'w1', 'messaging.system': 'bullmq' });
    expect(headersInJob.traceparent).toContain(parentTraceId);
  });

  it('marks failed jobs and skips repeating housekeeping jobs', async () => {
    await expect(inJobSpan('ingestion', { id: 'j', name: 'ingest', data: {} }, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await inJobSpan('maintenance', { id: 'reap', name: 'reap', data: {} }, async () => undefined);
    const names = exporter.getFinishedSpans().map((s) => [s.name, s.status.code]);
    expect(names).toEqual([['ingestion ingest', 2]]);
  });
});
