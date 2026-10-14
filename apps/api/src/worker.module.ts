import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { DomainModule } from './domain.module';
import { CostRollupService } from './modules/costs/rollup.service';
import { inJobSpan, observeGauge } from './infra/observability';
import { bullConnection, QUEUES, QueuesService } from './infra/queues.service';
import { DiscoveryService } from './modules/discovery/discovery.service';
import { IngestionExecutorService } from './modules/ingestion/ingestion-executor.service';
import { BudgetService } from './modules/ledger/budget.service';
import { LedgerService } from './modules/ledger/ledger.service';
import { PurgeService } from './modules/maintenance/purge.service';
import { ModelsService } from './modules/models/models.service';
import { RunExecutorService } from './modules/runs/run-executor.service';
import { StudioService } from './modules/studio/studio.service';
import { PrismaService } from './infra/prisma.service';
import { WORKER_FEATURE_HANDLERS } from './worker-features';

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Worker');
  private readonly workers: Worker[] = [];

  constructor(
    private readonly runs: RunExecutorService,
    private readonly ingestion: IngestionExecutorService,
    private readonly ledger: LedgerService,
    private readonly budgets: BudgetService,
    private readonly purge: PurgeService,
    private readonly queues: QueuesService,
    private readonly models: ModelsService,
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
    private readonly studio: StudioService,
    private readonly rollups: CostRollupService,
  ) {}

  async onModuleInit() {
    await this.models.ensureSeeded();
    const make = (name: string, concurrency: number, fn: (job: Job) => Promise<unknown>) => {
      const w = new Worker(name, (job) => inJobSpan(name, job, () => fn(job)), { connection: bullConnection(), concurrency });
      w.on('failed', (job, err) => this.log.warn(`${name} job ${job?.id} failed: ${err.message}`));
      this.workers.push(w);
    };

    make(QUEUES.ingestion, Number(process.env.FV_INGEST_CONCURRENCY ?? 2), (job) =>
      this.ingestion.execute(job.data.jobId, job.attemptsMade + 1, job.opts.attempts ?? 1),
    );
    make(QUEUES.runs, Number(process.env.FV_RUN_CONCURRENCY ?? 20), (job) => this.runs.execute(job.data.runId));
    make(QUEUES.ledger, 4, async (job) => {
      if (job.name === 'usage') return this.ledger.processUsageEvent(job.data.usageEventId);
      if (job.name === 'settle') {
        const pending = await this.prisma.usageEvent.findMany({ where: { runId: job.data.runId, processedAt: null } });
        for (const p of pending) await this.ledger.processUsageEvent(p.id);
        return this.budgets.releaseRun(job.data.runId);
      }
      if (job.name === 'sweep') return this.ledger.sweep();
      const handler = WORKER_FEATURE_HANDLERS[job.name];
      if (handler) return handler(job);
    });
    make(QUEUES.maintenance, 1, async (job) => {
      if (job.name === 'reap') return this.runs.reap();
      if (job.name === 'purge') return this.purge.purgeExpired();
      if (job.name === 'cost-rollup') return this.rollups.rollup(2);
      const handler = WORKER_FEATURE_HANDLERS[job.name];
      if (handler) return handler(job);
    });
    make(QUEUES.evaluations, 2, async (job) => {
      if (job.name === 'rec-eval') return this.discovery.runEvaluation(job.data.reportId);
      if (job.name === 'rag-eval') return this.studio.runEvaluation(job.data.evaluationId);
      const handler = WORKER_FEATURE_HANDLERS[job.name];
      if (handler) return handler(job);
    });

    await this.queues.queue(QUEUES.maintenance).add('reap', {}, { repeat: { every: 15_000 }, jobId: 'reap' });
    await this.queues.queue(QUEUES.maintenance).add('cost-rollup', {}, { repeat: { every: 600_000 }, jobId: 'cost-rollup' });
    await this.queues.queue(QUEUES.maintenance).add('purge', {}, { repeat: { pattern: '17 3 * * *' }, jobId: 'purge' });
    await this.queues.queue(QUEUES.ledger).add('sweep', {}, { repeat: { every: 30_000 }, jobId: 'sweep' });
    observeGauge('fv.queue.depth', 'Waiting, active and delayed jobs per queue', () => this.queues.depth(), 'queue');
    this.log.log('workers started: ingestion, ai-runs, ledger, maintenance, evaluations');
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}

@Module({ imports: [DomainModule], providers: [WorkerService] })
export class WorkerModule {}
