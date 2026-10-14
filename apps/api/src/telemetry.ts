// OpenTelemetry bootstrap. Loaded first by main.ts and worker.ts; a no-op unless
// OTEL_EXPORTER_OTLP_ENDPOINT is set. Span attributes never include prompts or source text.
import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { loadDotEnv } from './config/env';
import { onTelemetryShutdown } from './infra/observability';

loadDotEnv();
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (endpoint) {
  const base = endpoint.replace(/\/$/, '');
  const isWorker = process.argv.some((a) => a.includes('worker'));
  const resource = resourceFromAttributes({
    'service.name': process.env.OTEL_SERVICE_NAME || (isWorker ? 'folioverse-api-worker' : 'folioverse-api'),
    'service.namespace': 'folioverse',
    'deployment.environment': process.env.NODE_ENV || 'development',
  });
  const provider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${base}/v1/traces` }))],
  });
  provider.register();
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
        exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL || 15_000),
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);
  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => /\/(live|ready)$/.test(req.url ?? '') }),
      new ExpressInstrumentation(),
    ],
  });
  onTelemetryShutdown(async () => {
    await Promise.allSettled([provider.shutdown(), meterProvider.shutdown()]);
  });
}
