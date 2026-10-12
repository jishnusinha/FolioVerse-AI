import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config/env';

export const RUN_STREAM = (runId: string) => `fv:run:${runId}`;
export const WS_STREAM = (workspaceId: string) => `fv:ws:${workspaceId}`;
export const CANCEL_KEY = (runId: string) => `fv:cancel:${runId}`;
export const STREAM_MAXLEN = 10000;
export const STREAM_TTL_SECONDS = 24 * 3600;

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private readonly extra: Redis[] = [];

  constructor() {
    this.client = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  }

  /** Dedicated connection for blocking reads (XREAD BLOCK) so the shared client never stalls. */
  blockingClient(): Redis {
    const c = this.client.duplicate();
    this.extra.push(c);
    return c;
  }

  release(c: Redis) {
    const i = this.extra.indexOf(c);
    if (i >= 0) this.extra.splice(i, 1);
    c.disconnect();
  }

  /** Appends an event envelope to a stream and returns its stream id. */
  async append(stream: string, envelope: Record<string, unknown>): Promise<string> {
    const id = (await this.client.xadd(stream, 'MAXLEN', '~', String(STREAM_MAXLEN), '*', 'e', JSON.stringify(envelope))) as string;
    await this.client.expire(stream, STREAM_TTL_SECONDS);
    return id;
  }

  async onModuleDestroy() {
    for (const c of this.extra) c.disconnect();
    await this.client.quit().catch(() => undefined);
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
