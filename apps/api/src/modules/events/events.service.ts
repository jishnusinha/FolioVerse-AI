import { Global, Injectable, Module } from '@nestjs/common';
import { RedisService, RUN_STREAM, WS_STREAM } from '../../infra/redis.service';

export interface Envelope {
  schemaVersion: 1;
  type: string;
  seq: number;
  ts: string;
  runId?: string;
  workspaceId?: string;
  traceId?: string;
  data: Record<string, unknown>;
}

@Injectable()
export class EventsService {
  constructor(private readonly redis: RedisService) {}

  envelope(type: string, data: Record<string, unknown>, extra: Partial<Envelope> = {}): Envelope {
    return { schemaVersion: 1, type, seq: extra.seq ?? 0, ts: new Date().toISOString(), data, ...extra };
  }

  async publishWorkspace(workspaceId: string, type: string, data: Record<string, unknown>) {
    return this.redis.append(WS_STREAM(workspaceId), this.envelope(type, data, { workspaceId }) as any);
  }

  async publishRun(runId: string, env: Envelope) {
    return this.redis.append(RUN_STREAM(runId), env as any);
  }
}

@Global()
@Module({ providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
