import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { OperationObject, ParameterObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/** Shared HTTP configuration used by main.ts, tests and the OpenAPI exporter. */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } }));
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  return app;
}

export function openApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('FolioVerse API')
    .setVersion('1.0.0')
    .setDescription('Same-origin JSON API. Auth via HttpOnly cookies (fv_at) plus double-submit CSRF header x-csrf-token.')
    .addCookieAuth('fv_at')
    .build();
  return relaxImplicitQueryParams(SwaggerModule.createDocument(app, config));
}

/**
 * Nest marks every bare `@Query('name')` parameter as required, but handlers treat those as optional filters.
 * Parameters that really are required declare `@ApiQuery({ required: true, description })`; the description
 * is what distinguishes them here.
 */
export function relaxImplicitQueryParams(doc: OpenAPIObject): OpenAPIObject {
  for (const item of Object.values(doc.paths)) {
    for (const op of Object.values(item) as OperationObject[]) {
      for (const p of (op?.parameters ?? []) as ParameterObject[]) {
        if (p.in === 'query' && !p.description) p.required = false;
      }
    }
  }
  return doc;
}
