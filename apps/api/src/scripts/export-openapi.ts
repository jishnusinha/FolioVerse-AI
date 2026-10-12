// Exports the OpenAPI document to packages/contracts/openapi/api.json without starting servers
// or touching databases (connections are lazy and never awaited here).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

process.env.DATABASE_URL ??= 'postgresql://export:export@127.0.0.1:1/export';
process.env.FV_JWT_SECRET ??= 'x'.repeat(48);
process.env.FV_INTERNAL_JWT_PRIVATE_KEY ??= 'unused';
process.env.FV_INTERNAL_JWT_PUBLIC_KEY ??= 'unused';
process.env.REDIS_URL ??= 'redis://127.0.0.1:1';

async function main() {
  const { AppModule } = await import('../app.module');
  const { configureApp, openApiDocument } = await import('../bootstrap');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false, preview: true });
  configureApp(app);
  const doc = openApiDocument(app);
  const out = resolve(__dirname, '../../../../packages/contracts/openapi');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'api.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log(`wrote ${join(out, 'api.json')} (${Object.keys(doc.paths).length} paths)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
