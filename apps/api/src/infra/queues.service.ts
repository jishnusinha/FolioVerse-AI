import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env';
import { withTraceContext } from './observability';

export const QUEUES = {
  ingestion: 'ingestion',
  runs: 'ai-runs',
  ledger: 'ledger',
  maintenance: 'maintenance',
  evaluations: 'evaluations',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export function bullConnection() {
  return new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
}

/** Queue that stamps the enqueuing trace context into each job payload (no-op when tracing is off). */
class TracedQueue extends Queue {
  override add(name: string, data: any, opts?: JobsOptions) {
    return super.add(name, withTraceContext(data), opts);
  }
}

@Injectable()
export class QueuesService implements OnModuleDestroy {
  private readonly connection = bullConnection();
  private readonly queues = new Map<string, Queue>();

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new TracedQueue(name, {
        connection: this.connection,
        defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
      });
      this.queues.set(name, q);
    }
    return q;
  }

  async depth(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const name of Object.values(QUEUES)) {
      const counts = await this.queue(name).getJobCounts('waiting', 'active', 'delayed');
      out[name] = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
    }
    return out;
  }

  async onModuleDestroy() {
    for (const q of this.queues.values()) await q.close();
    this.connection.disconnect();
  }
}

@Global()
@Module({ providers: [QueuesService], exports: [QueuesService] })
export class QueuesModule {}
