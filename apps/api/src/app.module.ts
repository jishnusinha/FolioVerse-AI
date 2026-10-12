import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './common/auth.guard';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { ProblemFilter } from './common/problem.filter';
import { RedisThrottlerStorage } from './common/throttler-redis.storage';
import { DomainModule } from './domain.module';
import { RedisService } from './infra/redis.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { CostsController } from './modules/costs/costs.controller';
import { SseController } from './modules/events/sse.controller';
import { HealthController } from './modules/health/health.controller';
import { ModelsController } from './modules/models/models.controller';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { ProjectsController } from './modules/projects/projects.controller';
import { RunsController } from './modules/runs/runs.controller';
import { SourcesController } from './modules/sources/sources.controller';
import { ThreadsController } from './modules/threads/threads.controller';
import { WorkspacesController } from './modules/workspaces/workspaces.controller';
import { FEATURE_CONTROLLERS, FEATURE_PROVIDERS } from './features';

@Module({
  imports: [
    DomainModule,
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 10_000 : 600 }],
        storage: new RedisThrottlerStorage(redis.client, process.env.NODE_ENV === 'test' ? `fv:throttle:test:${randomUUID()}` : undefined),
      }),
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    WorkspacesController,
    ProjectsController,
    SourcesController,
    RunsController,
    SseController,
    ThreadsController,
    CostsController,
    ModelsController,
    NotificationsController,
    ...FEATURE_CONTROLLERS,
  ],
  providers: [
    AuthService,
    ...FEATURE_PROVIDERS,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
