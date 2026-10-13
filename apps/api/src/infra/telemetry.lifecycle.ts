import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { shutdownTelemetry } from './observability';

/** Flushes buffered spans and metrics after Nest has closed (SIGTERM on Cloud Run). */
@Injectable()
export class TelemetryLifecycle implements OnApplicationShutdown {
  onApplicationShutdown() {
    return shutdownTelemetry();
  }
}
