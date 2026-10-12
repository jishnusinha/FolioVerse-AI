import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
  return SwaggerModule.createDocument(app, config);
}
