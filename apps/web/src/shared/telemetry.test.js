import { describe, expect, it, vi } from 'vitest';
import { describeApiPath, traceSse } from './telemetry.js';

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {
    export(_spans, done) {
      done({ code: 0 });
    }
    shutdown() {
      return Promise.resolve();
    }
    forceFlush() {
      return Promise.resolve();
    }
  },
}));

const WS = '0190f0f0-0000-7000-8000-0000000000aa';
const RUN = '0190f0f0-0000-7000-8000-0000000000bb';

describe('browser telemetry', () => {
  it('turns ids into route templates and drops query strings', () => {
    expect(describeApiPath(`/api/workspaces/${WS}/runs/${RUN}/events?lastEventId=1-0`)).toEqual({
      route: '/api/workspaces/:id/runs/:id/events',
      attrs: { 'fv.workspace_id': WS, 'fv.run_id': RUN },
    });
    expect(describeApiPath('/api/auth/me?q=private text').route).toBe('/api/auth/me');
  });

  it('is a pass-through when tracing is off', async () => {
    const seen = [];
    const status = await traceSse(`/workspaces/${WS}/events`, async ({ headers, tick }) => {
      seen.push(headers);
      tick();
      return 200;
    });
    expect(status).toBe(200);
    expect(seen).toEqual([{}]);
  });

  it('sends a traceparent on SSE connections once the SDK is started', async () => {
    const { startWebTracing } = await import('./otel.js');
    const hook = startWebTracing();
    let headers = {};
    await hook(`/workspaces/${WS}/runs/${RUN}/events`, async (t) => {
      headers = t.headers;
      t.tick();
      return 200;
    });
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
  });
});
