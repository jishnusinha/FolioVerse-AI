import './telemetry';
import 'reflect-metadata';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { PinoNestLogger } from './common/logger';
import { env } from './config/env';
import { QueuesService } from './infra/queues.service';
import { WorkerModule } from './worker.module';

async function main() {
  env();
  process.env.FV_SERVICE_NAME ??= 'api-worker';
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: new PinoNestLogger() });
  app.enableShutdownHooks();

  // Cloud Run services must answer HTTP on $PORT; the worker serves only liveness and readiness.
  const healthPort = Number(process.env.FV_WORKER_HEALTH_PORT ?? 0);
  if (healthPort) {
    const queues = app.get(QueuesService);
    const server = createServer((req, res) => {
      if (!/\/ready$/.test(req.url ?? '')) return void res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      queues.depth().then(
        () => res.writeHead(200, { 'content-type': 'text/plain' }).end('ready'),
        () => res.writeHead(503, { 'content-type': 'text/plain' }).end('queue backend unavailable'),
      );
    }).listen(healthPort, '0.0.0.0');
    process.once('SIGTERM', () => server.close());
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
