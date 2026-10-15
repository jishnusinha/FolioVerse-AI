import './telemetry';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp, openApiDocument } from './bootstrap';
import { env } from './config/env';
import { PinoNestLogger } from './common/logger';
import { StorageService } from './infra/storage.service';
import { ModelsService } from './modules/models/models.service';

async function main() {
  const e = env();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: new PinoNestLogger(), bodyParser: true });
  configureApp(app);
  app.set('trust proxy', e.FV_TRUST_PROXY_HOPS);
  if (e.NODE_ENV !== 'production') SwaggerModule.setup('api/docs', app, openApiDocument(app));
  // Production refuses to start without a usable bucket; development keeps serving and reports it in /api/ready.
  await app
    .get(StorageService)
    .ensureBucket()
    .catch((err: Error) => {
      if (e.NODE_ENV === 'production') throw err;
      new Logger('Storage').warn(err.message);
    });
  await app.get(ModelsService).ensureSeeded();
  await app.listen(e.PORT, '0.0.0.0');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
