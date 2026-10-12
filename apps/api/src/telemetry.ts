// OpenTelemetry bootstrap. Loaded first by main.ts and worker.ts; a no-op unless
// OTEL_EXPORTER_OTLP_ENDPOINT is set. Span attributes never include prompts or source text.
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { Resource } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { loadDotEnv } from './config/env';

loadDotEnv();
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (endpoint) {
  const isWorker = process.argv.some((a) => a.includes('worker'));
  const provider = new NodeTracerProvider({
    resource: new Resource({
      'service.name': process.env.OTEL_SERVICE_NAME || (isWorker ? 'folioverse-api-worker' : 'folioverse-api'),
      'deployment.environment': process.env.NODE_ENV || 'development',
    }),
  });
  provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` })));
  provider.register();
  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => /\/(live|ready)$/.test(req.url ?? '') }),
      new ExpressInstrumentation(),
    ],
  });
}
