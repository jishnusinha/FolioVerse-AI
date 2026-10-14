import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { describeApiPath } from './telemetry.js';

/** SSE responses never finish like normal fetches; they get their own span from traceSse. */
const SSE_URL = /\/api\/workspaces\/[^/]+\/(runs\/[^/]+\/)?events/;

/**
 * Starts browser tracing: one CLIENT span per /api fetch (traceparent propagated to the API)
 * and one span per SSE connection. Spans go to the same-origin /otlp proxy, so the CSP is unchanged.
 */
export function startWebTracing() {
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'folioverse-web', 'service.namespace': 'folioverse' }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${window.location.origin}/otlp/v1/traces` }))],
  });
  provider.register();
  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        ignoreUrls: [/\/otlp\//, SSE_URL],
        clearTimingResources: true,
        applyCustomAttributesOnSpan: (span) => {
          const spanAttrs = /** @type {any} */ (span).attributes ?? {};
          const url = spanAttrs['url.full'] ?? spanAttrs['http.url'];
          if (typeof url !== 'string') return;
          const { pathname } = new URL(url, window.location.origin);
          const { route, attrs } = describeApiPath(pathname);
          const templated = `${window.location.origin}${route}`;
          span.setAttributes({ ...attrs, 'http.url': templated, 'url.full': templated, 'http.route': route });
        },
      }),
    ],
  });

  const tracer = trace.getTracer('folioverse-web');
  return (path, fn) => {
    const { route, attrs } = describeApiPath(`/api${path}`);
    const span = tracer.startSpan(`SSE ${route}`, { kind: SpanKind.CLIENT, attributes: { ...attrs, 'http.route': route } });
    /** @type {Record<string,string>} */
    const headers = {};
    propagation.inject(trace.setSpan(context.active(), span), headers);
    let events = 0;
    return fn({ headers, tick: () => (events += 1) })
      .then((status) => {
        span.setAttributes({ 'http.response.status_code': status, 'fv.sse.events': events });
        return status;
      })
      .catch((e) => {
        span.recordException(e);
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(e?.message ?? e).slice(0, 200) });
        throw e;
      })
      .finally(() => span.end());
  };
}
