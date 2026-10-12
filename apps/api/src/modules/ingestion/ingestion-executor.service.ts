import { Injectable, Logger } from '@nestjs/common';
import type { IngestionState } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service';
import { StorageService } from '../../infra/storage.service';
import { AiClientService, AiServiceError } from '../ai-client/ai-client.service';
import { SourcesService } from '../sources/sources.service';

const TERMINAL: IngestionState[] = ['READY', 'PARTIAL', 'FAILED', 'QUARANTINED'];

@Injectable()
export class IngestionExecutorService {
  private readonly log = new Logger('Ingestion');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiClientService,
    private readonly sources: SourcesService,
  ) {}

  /**
   * Runs one ingestion job. Throws only for retryable failures so BullMQ retries with backoff;
   * permanent failures are recorded as FAILED/QUARANTINED and swallowed.
   */
  async execute(jobId: string, attempt: number, maxAttempts: number) {
    const job = await this.prisma.ingestionJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    const version = await this.prisma.sourceVersion.findUnique({ where: { id: job.sourceVersionId } });
    if (!version || version.ingestionState === 'QUARANTINED') return;
    const source = await this.prisma.source.findUnique({ where: { id: version.sourceId } });
    if (!source || source.deletedAt) return;
    const obj = await this.prisma.storedObject.findUniqueOrThrow({ where: { id: version.storedObjectId } });

    await this.prisma.ingestionJob.update({ where: { id: jobId }, data: { state: 'PARSING', attempts: attempt, startedAt: new Date(), error: null } });
    await this.sources.setState(job.workspaceId, source.id, version.id, 'PARSING', undefined, 0.2);

    const body = {
      jobId,
      workspaceId: job.workspaceId,
      projectId: source.projectId,
      sourceId: source.id,
      sourceVersionId: version.id,
      title: source.title,
      mimeType: version.mimeType,
      objectUrl: await this.storage.signedGetUrl(obj.key, 1800, true),
      sha256: version.sha256,
    };

    let final: { state: IngestionState; stats?: any; error?: string } | null = null;
    try {
      for await (const ev of this.ai.stream('ingest', '/internal/ingest/units', body, { timeoutMs: 900_000 })) {
        if (ev.type === 'ingestion.stage') {
          const state = ev.data.state as IngestionState;
          if (!TERMINAL.includes(state)) {
            await this.prisma.ingestionJob.update({ where: { id: jobId }, data: { state } });
            await this.sources.setState(job.workspaceId, source.id, version.id, state, undefined, ev.data.progress);
          }
        } else if (ev.type === 'ingestion.finished') {
          final = { state: ev.data.state, stats: ev.data.stats, error: ev.data.error };
        }
      }
    } catch (e) {
      const retryable = e instanceof AiServiceError ? e.retryable : true;
      const msg = (e as Error).message.slice(0, 500);
      this.log.warn(`job ${jobId} attempt ${attempt} failed: ${msg}`);
      if (retryable && attempt < maxAttempts) {
        await this.prisma.ingestionJob.update({ where: { id: jobId }, data: { error: msg } });
        throw e;
      }
      final = { state: 'FAILED', error: msg };
    }
    final ??= { state: 'FAILED', error: 'Ingestion ended without a result' };

    await this.prisma.ingestionJob.update({
      where: { id: jobId },
      data: { state: final.state, stats: final.stats ?? undefined, error: final.error ?? null, finishedAt: new Date() },
    });
    if (final.stats?.pages) await this.prisma.sourceVersion.update({ where: { id: version.id }, data: { pageCount: final.stats.pages } });
    await this.sources.setState(job.workspaceId, source.id, version.id, final.state, final.error, 1);
    await this.sources.stage(job.workspaceId, source.id, version.id, final.state, 1, final.error);
  }
}
