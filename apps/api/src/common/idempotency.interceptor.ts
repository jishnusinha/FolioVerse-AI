import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { PrismaService } from '../infra/prisma.service';

/**
 * Honors an optional Idempotency-Key header on mutating requests: the first response is stored
 * per (user, key) and replayed for retries. A reused key on a different route is a conflict.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const key = req.headers['idempotency-key'] as string | undefined;
    if (!key || !req.user || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next.handle();
    const path = req.route?.path ?? req.path;

    return from(this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId: req.user.id, key } } })).pipe(
      switchMap((hit) => {
        if (hit) {
          if (hit.method !== req.method || hit.path !== path) throw new ConflictException('Idempotency-Key reused for a different request');
          res.status(hit.responseStatus);
          res.setHeader('Idempotent-Replay', 'true');
          return of(hit.responseBody);
        }
        return next.handle().pipe(
          tap((body) => {
            void this.prisma.idempotencyKey
              .create({
                data: {
                  userId: req.user.id,
                  key,
                  method: req.method,
                  path,
                  responseStatus: res.statusCode,
                  responseBody: (body ?? null) as any,
                },
              })
              .catch(() => undefined);
          }),
        );
      }),
    );
  }
}
