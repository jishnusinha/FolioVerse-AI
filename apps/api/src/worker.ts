import './telemetry';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PinoNestLogger } from './common/logger';
import { env } from './config/env';
import { WorkerModule } from './worker.module';

async function main() {
  env();
  process.env.FV_SERVICE_NAME ??= 'api-worker';
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: new PinoNestLogger() });
  app.enableShutdownHooks();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
