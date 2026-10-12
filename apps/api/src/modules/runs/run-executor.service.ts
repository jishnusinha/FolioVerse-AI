import { Injectable, Logger } from '@nestjs/common';
import type { RunStatus } from '@prisma/client';
import { CryptoService } from '../../common/crypto.service';
import { newId } from '../../common/ids';
import { rootLogger } from '../../common/logger';
import { PrismaService } from '../../infra/prisma.service';
import { QUEUES, QueuesService } from '../../infra/queues.service';
import { CANCEL_KEY, RedisService } from '../../infra/redis.service';
import { AiClientService, AiServiceError } from '../ai-client/ai-client.service';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { WRITER_GRAPHS, WriterService } from '../writer/writer.service';
import { EventsService } from '../events/events.service';
import { BudgetService } from '../ledger/budget.service';
import { TERMINAL } from './runs.service';

/** Event types persisted to ai_run_events. Token deltas are streamed only. */
const PERSISTED = new Set([
  'run.started',
  'run.state',
  'node.started',
  'node.finished',
  'retrieval.completed',
  'citation.validated',
  'usage.recorded',
  'cost.updated',
  'run.finished',
  'run.failed',
]);
const HEARTBEAT_MS = 10_000;
const CHECKPOINT_MS = 2_000;

@Injectable()
export class RunExecutorService {
  private readonly log = new Logger('RunExecutor');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly events: EventsService,
    private readonly ai: AiClientService,
    private readonly crypto: CryptoService,
    private readonly queues: QueuesService,
    private readonly budgets: BudgetService,
    private readonly artifacts: ArtifactsService,
    private readonly writer: WriterService,
  ) {}

  private async setStatus(runId: string, status: RunStatus, seq: number, extra: Record<string, unknown> = {}) {
    await this.prisma.aiRun.update({ where: { id: runId }, data: { status, lastSeq: seq, ...extra } });
  }

  /** Builds the conversation history along the parent chain of the user message (branch-aware). */
  private async history(threadId: string | null, assistantMessageId: string | null) {
    if (!threadId || !assistantMessageId) return [];
    const msgs = await this.prisma.message.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' } });
    const byId = new Map(msgs.map((m) => [m.id, m]));
    const chain: { role: 'user' | 'assistant'; content: string }[] = [];
    let cur = byId.get(assistantMessageId)?.parentMessageId ?? null;
    // Skip the current user question (sent as input); include earlier turns.
    cur = cur ? byId.get(cur)?.parentMessageId ?? null : null;
    while (cur && chain.length < 12) {
      const m = byId.get(cur);
      if (!m) break;
      if (m.status !== 'FAILED' && m.content) chain.unshift({ role: m.role === 'USER' ? 'user' : 'assistant', content: m.content.slice(0, 4000) });
      cur = m.parentMessageId;
    }
    return chain;
  }

  async execute(runId: string) {
    const run = await this.prisma.aiRun.findUnique({ where: { id: runId } });
    if (!run || run.status !== 'QUEUED') return;
    const cancelled = await this.redis.client.get(CANCEL_KEY(runId));
    if (cancelled) return;

    let seq = run.lastSeq;
    const emit = async (type: string, data: Record<string, unknown>) => {
      seq += 1;
      const env = this.events.envelope(type, data, { runId, workspaceId: run.workspaceId, seq });
      await this.events.publishRun(runId, env);
      if (PERSISTED.has(type)) {
        await this.prisma.aiRunEvent.create({ data: { id: newId(), workspaceId: run.workspaceId, runId, seq, type, data: data as any } });
      }
    };

    const claimed = await this.prisma.aiRun.updateMany({
      where: { id: runId, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date(), heartbeatAt: new Date() },
    });
    if (claimed.count !== 1) return;
    await emit('run.state', { status: 'RUNNING' });

    const scope = (run.scope as any) ?? {};
    const scopeToken = await this.crypto.signScope(runId, run.workspaceId, scope.sourceVersionIds ?? []);
    const body = {
      runId,
      workspaceId: run.workspaceId,
      graph: run.graph,
      input: run.input,
      history: await this.history(run.threadId, run.messageId),
      modelPlan: run.modelPlan,
      scopeToken,
      options: run.options ?? {},
      resumeFromCheckpoint: run.forkedFromCheckpoint ?? undefined,
      parentRunId: run.parentRunId ?? undefined,
    };

    const abort = new AbortController();
    let text = '';
    let lastCheckpoint = Date.now();
    let lastBeat = Date.now();
    let streaming = false;
    let finished: Record<string, any> | null = null;
    let failed: Record<string, any> | null = null;
    const citations: Record<string, any>[] = [];
    const nodeStarts = new Map<string, Date>();

    const cancelPoll = setInterval(async () => {
      if (await this.redis.client.get(CANCEL_KEY(runId))) abort.abort();
    }, 1000);

    try {
      for await (const ev of this.ai.stream('api', '/internal/runs/units', body, { signal: abort.signal, timeoutMs: 600_000 })) {
        const type: string = ev.type;
        const data: Record<string, any> = ev.data ?? {};
        if (type === 'heartbeat') {
          // keep-alive from the AI service; not relayed
        } else if (type === 'token.delta') {
          if (!streaming) {
            streaming = true;
            await this.setStatus(runId, 'STREAMING', seq);
            await emit('run.state', { status: 'STREAMING' });
          }
          text += data.text ?? '';
          await emit(type, data);
        } else if (type === 'node.started') {
          nodeStarts.set(`${data.step}:${data.node}`, new Date());
          await this.prisma.nodeExecution.upsert({
            where: { runId_step_node: { runId, step: data.step, node: data.node } },
            create: { id: newId(), workspaceId: run.workspaceId, runId, node: data.node, step: data.step, status: 'RUNNING', startedAt: new Date() },
            update: {},
          });
          await emit(type, data);
        } else if (type === 'node.finished') {
          const started = nodeStarts.get(`${data.step}:${data.node}`) ?? new Date();
          await this.prisma.nodeExecution.upsert({
            where: { runId_step_node: { runId, step: data.step, node: data.node } },
            create: {
              id: newId(),
              workspaceId: run.workspaceId,
              runId,
              node: data.node,
              step: data.step,
              status: data.status,
              startedAt: started,
              finishedAt: new Date(),
              durationMs: data.durationMs,
              summary: data.summary ?? undefined,
            },
            update: { status: data.status, finishedAt: new Date(), durationMs: data.durationMs, summary: data.summary ?? undefined },
          });
          await emit(type, data);
        } else if (type === 'usage.recorded') {
          await this.prisma.modelCall
            .create({
              data: {
                id: data.modelCallId,
                workspaceId: run.workspaceId,
                runId,
                modelConfigId: data.modelConfigId ?? 'unknown',
                provider: data.provider,
                model: data.model,
                attempt: data.attempt ?? 1,
                status: data.status ?? 'OK',
                latencyMs: data.latencyMs ?? null,
                errorClass: data.errorClass ?? null,
              },
            })
            .catch(() => undefined);
          await this.queues.queue(QUEUES.ledger).add('usage', { usageEventId: data.usageEventId }, { jobId: `usage-${data.usageEventId}` });
          await emit(type, data);
        } else if (type === 'citation.validated') {
          citations.push(data);
          await emit(type, data);
        } else if (type === 'run.finished') {
          finished = data;
        } else if (type === 'run.failed') {
          failed = data;
        } else {
          await emit(type, data);
        }

        const now = Date.now();
        if (run.messageId && streaming && now - lastCheckpoint > CHECKPOINT_MS) {
          lastCheckpoint = now;
          await this.prisma.message.update({ where: { id: run.messageId }, data: { content: text } });
        }
        if (now - lastBeat > HEARTBEAT_MS) {
          lastBeat = now;
          await this.prisma.aiRun.update({ where: { id: runId }, data: { heartbeatAt: new Date(), lastSeq: seq } });
        }
      }
    } catch (e) {
      if (abort.signal.aborted) {
        failed = { errorClass: 'CANCELLED', message: 'Cancelled by user', retryable: false };
      } else {
        const retryable = e instanceof AiServiceError ? e.retryable : true;
        failed = { errorClass: 'INTERNAL', message: (e as Error).message.slice(0, 500), retryable };
        rootLogger.error({ runId, err: (e as Error).message }, 'run stream failed');
      }
    } finally {
      clearInterval(cancelPoll);
    }

    if (!finished && !failed) failed = { errorClass: 'INTERNAL', message: 'AI service closed the stream without a result', retryable: true };
    await this.finalize(run, seq, emit, text, citations, finished, failed);
  }

  private async finalize(
    run: { id: string; workspaceId: string; messageId: string | null; graph: string },
    seq: number,
    emit: (type: string, data: Record<string, unknown>) => Promise<void>,
    text: string,
    citations: Record<string, any>[],
    finished: Record<string, any> | null,
    failed: Record<string, any> | null,
  ) {
    const current = await this.prisma.aiRun.findUnique({ where: { id: run.id } });
    if (!current || TERMINAL.has(current.status)) return;

    if (finished) {
      const answer: string = finished.answer ?? text;
      const outcome = finished.outcome ?? 'ANSWERED';
      const status: RunStatus = finished.status ?? 'SUCCEEDED';
      if (run.messageId) {
        await this.prisma.message.update({
          where: { id: run.messageId },
          data: { content: answer, status: outcome === 'ABSTAINED' ? 'ABSTAINED' : 'COMPLETE' },
        });
        for (const c of citations) {
          await this.prisma.messageCitation
            .create({
              data: {
                id: newId(),
                workspaceId: run.workspaceId,
                messageId: run.messageId,
                marker: c.marker,
                chunkId: c.anchor?.chunkId ?? null,
                sourceVersionId: c.anchor?.sourceVersionId,
                state: c.state,
                score: c.score ?? 0,
                quote: c.quote ?? '',
                anchor: c.anchor ?? {},
              },
            })
            .catch(() => undefined);
        }
      }
      await this.prisma.aiRun.update({
        where: { id: run.id },
        data: { status, outcome, finishedAt: new Date(), result: { answer, artifact: finished.artifact ?? null } as any, lastSeq: seq + 1 },
      });
      const artifactId =
        finished.artifact && (status === 'SUCCEEDED' || status === 'PARTIAL') && outcome !== 'ABSTAINED'
          ? await this.artifacts.recordFromRun(run.id, finished.artifact).catch((e) => {
              rootLogger.error({ runId: run.id, err: (e as Error).message }, 'artifact save failed');
              return null;
            })
          : null;
      if (WRITER_GRAPHS.has(run.graph) && (status === 'SUCCEEDED' || status === 'PARTIAL')) await this.writer.recordFromRun(run.id, finished.artifact ?? null);
      await emit('run.finished', { status, outcome, answer, artifact: finished.artifact ?? null, artifactId });
    } else if (failed) {
      const status: RunStatus = failed.errorClass === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
      if (run.messageId) await this.prisma.message.update({ where: { id: run.messageId }, data: { status: 'FAILED', content: text } });
      await this.prisma.aiRun.update({ where: { id: run.id }, data: { status, finishedAt: new Date(), error: failed as any, lastSeq: seq + 1 } });
      await emit('run.failed', failed);
    }
    await this.queues.queue(QUEUES.ledger).add('settle', { runId: run.id }, { jobId: `settle-${run.id}`, delay: 1500 });
  }

  /** Marks runs whose worker stopped heartbeating as INTERRUPTED and frees their reservations. */
  async reap(staleMs = 45_000) {
    const stale = await this.prisma.aiRun.findMany({
      where: { status: { in: ['RUNNING', 'STREAMING'] }, heartbeatAt: { lt: new Date(Date.now() - staleMs) } },
      take: 100,
    });
    for (const r of stale) {
      const n = await this.prisma.aiRun.updateMany({
        where: { id: r.id, status: { in: ['RUNNING', 'STREAMING'] } },
        data: { status: 'INTERRUPTED', finishedAt: new Date(), error: { errorClass: 'INTERNAL', message: 'Worker stopped heartbeating', retryable: true } },
      });
      if (!n.count) continue;
      if (r.messageId) await this.prisma.message.update({ where: { id: r.messageId }, data: { status: 'FAILED' } }).catch(() => undefined);
      await this.events.publishRun(r.id, this.events.envelope('run.state', { status: 'INTERRUPTED', reason: 'heartbeat timeout' }, { runId: r.id, seq: r.lastSeq + 1 }));
      await this.budgets.releaseRun(r.id);
      this.log.warn(`run ${r.id} interrupted (stale heartbeat)`);
    }
    return stale.length;
  }
}
