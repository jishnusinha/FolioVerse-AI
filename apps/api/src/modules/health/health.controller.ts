import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { env } from '../../config/env';
import { Public } from '../../common/auth.decorators';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { StorageService } from '../../infra/storage.service';

async function timed<T>(fn: () => Promise<T>, ms = 2500): Promise<boolean> {
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    return true;
  } catch {
    return false;
  }
}

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [db, redis, storage, ai] = await Promise.all([
      timed(() => this.prisma.$queryRaw`SELECT 1`),
      timed(() => this.redis.client.ping()),
      timed(async () => {
        if (!(await this.storage.ping())) throw new Error('storage');
      }),
      timed(async () => {
        const r = await fetch(`${env().FV_AI_API_URL}/readyz`, { signal: AbortSignal.timeout(2000) });
        if (!r.ok) throw new Error('ai');
      }),
    ]);
    const checks = { database: db, redis, storage, aiService: ai };
    const ok = db && redis && storage;
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ready' : 'degraded', checks };
  }
}
