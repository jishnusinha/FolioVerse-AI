import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { env } from '../../config/env';
import { AuthUser } from '../../common/auth.decorators';
import { isUuid, newId } from '../../common/ids';
import { PrismaService } from '../../infra/prisma.service';
import { QUEUES, QueuesService } from '../../infra/queues.service';
import { CANCEL_KEY, RedisService } from '../../infra/redis.service';
import { EventsService } from '../events/events.service';
import { BudgetService } from '../ledger/budget.service';
import { LedgerService } from '../ledger/ledger.service';
import { estimateTokens, priceUsage } from '../ledger/pricing';
import { ModelsService } from '../models/models.service';

export const GRAPH_TIERS: Record<string, 'T0' | 'T1' | 'T2'> = {
  grounded_qa: 'T1',
  insight: 'T0',
  multi_doc_compare: 'T1',
  risk_contradiction: 'T1',
  knowledge_map: 'T1',
  writer_revision: 'T0',
  continuity_check: 'T1',
  dna_extraction: 'T1',
  passage_explain: 'T0',
  research_writing: 'T2',
  rec_explain: 'T0',
};

/** Graphs whose answers are grounded in workspace sources and therefore need a retrieval scope. */
export const RETRIEVAL_GRAPHS = new Set(['grounded_qa', 'insight', 'multi_doc_compare', 'risk_contradiction', 'knowledge_map', 'passage_explain', 'research_writing']);
/** Graphs that produce a conversational message in a thread. */
export const CHAT_GRAPHS = new Set(['grounded_qa', 'research_writing']);

export const TERMINAL = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'BUDGET_REJECTED']);

export interface RunSpec {
  graph: string;
  threadId?: string;
  parentMessageId?: string;
  input: { question?: string; action?: string; text?: string; params?: Record<string, unknown> };
  scope?: { projectId?: string; sourceIds?: string[]; sourceVersionIds?: string[] };
  modelPreference?: string;
  lab?: boolean;
  options?: Record<string, unknown>;
  parentRunId?: string;
  forkedFromCheckpoint?: string;
}

@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly models: ModelsService,
    private readonly budgets: BudgetService,
    private readonly ledger: LedgerService,
    private readonly queues: QueuesService,
    private readonly redis: RedisService,
    private readonly events: EventsService,
  ) {}

  async getRun(workspaceId: string, runId: string) {
    if (!isUuid(runId)) throw new NotFoundException();
    const run = await this.prisma.aiRun.findFirst({ where: { id: runId, workspaceId } });
    if (!run) throw new NotFoundException();
    return run;
  }

  /** Resolves the retrieval scope to explicit, readable source versions in this workspace. */
  async resolveScope(workspaceId: string, scope: RunSpec['scope'] = {}) {
    const ready = { in: ['READY', 'PARTIAL'] as any };
    let versionIds: string[] = [];
    if (scope.sourceVersionIds?.length) {
      const vs = await this.prisma.sourceVersion.findMany({
        where: { id: { in: scope.sourceVersionIds.filter(isUuid) }, workspaceId, ingestionState: ready },
      });
      const live = await this.prisma.source.findMany({ where: { id: { in: vs.map((v) => v.sourceId) }, deletedAt: null } });
      const liveIds = new Set(live.map((s) => s.id));
      versionIds = vs.filter((v) => liveIds.has(v.sourceId)).map((v) => v.id);
    } else if (scope.sourceIds?.length) {
      const ss = await this.prisma.source.findMany({ where: { id: { in: scope.sourceIds.filter(isUuid) }, workspaceId, deletedAt: null } });
      const vs = await this.prisma.sourceVersion.findMany({
        where: { id: { in: ss.map((s) => s.currentVersionId!).filter(Boolean) }, ingestionState: ready },
      });
      versionIds = vs.map((v) => v.id);
    } else if (scope.projectId && isUuid(scope.projectId)) {
      const ss = await this.prisma.source.findMany({ where: { projectId: scope.projectId, workspaceId, deletedAt: null } });
      const vs = await this.prisma.sourceVersion.findMany({
        where: { id: { in: ss.map((s) => s.currentVersionId!).filter(Boolean) }, ingestionState: ready },
      });
      versionIds = vs.map((v) => v.id);
    }
    return versionIds;
  }

  async preflightEstimate(modelConfigId: string, inputText: string, maxOutputTokens: number) {
    const price = await this.ledger.priceFor(modelConfigId);
    const priced = priceUsage(
      price
        ? {
            inputPerMTok: price.inputPerMTok.toString(),
            outputPerMTok: price.outputPerMTok.toString(),
            cachedInputPerMTok: price.cachedInputPerMTok?.toString(),
            reasoningPerMTok: price.reasoningPerMTok?.toString(),
            batchDiscount: price.batchDiscount?.toString(),
          }
        : null,
      { input: estimateTokens(inputText) + 3500, output: maxOutputTokens },
    );
    return { amount: priced.amount, priced: !!price, isDemo: !!price?.isDemo };
  }

  async create(workspaceId: string, user: AuthUser, spec: RunSpec) {
    const tier = GRAPH_TIERS[spec.graph];
    if (!tier) throw new BadRequestException({ message: 'Unknown graph', code: 'UNKNOWN_GRAPH' });
    if (spec.options?.inject && !env().FV_LAB_FAULTS) throw new BadRequestException({ message: 'Failure injection is disabled', code: 'LAB_DISABLED' });
    if (spec.options?.inject && !spec.lab) throw new BadRequestException({ message: 'Failure injection is only allowed for lab runs', code: 'LAB_ONLY' });

    let svids: string[] = [];
    if (RETRIEVAL_GRAPHS.has(spec.graph)) {
      svids = await this.resolveScope(workspaceId, spec.scope);
      if (!svids.length) throw new BadRequestException({ message: 'No ready sources in scope. Wait for ingestion to finish or pick other sources.', code: 'EMPTY_SCOPE' });
    }

    const plan = await this.models.resolvePlan(spec.modelPreference);
    const runId = newId();

    // Conversation bookkeeping for chat graphs.
    let threadId: string | null = null;
    let userMessageId: string | null = null;
    let assistantMessageId: string | null = null;
    if (CHAT_GRAPHS.has(spec.graph)) {
      const question = (spec.input.question ?? '').trim();
      if (!question) throw new BadRequestException('A question is required');
      if (spec.threadId) {
        if (!isUuid(spec.threadId)) throw new NotFoundException();
        const t = await this.prisma.thread.findFirst({ where: { id: spec.threadId, workspaceId } });
        if (!t) throw new NotFoundException('Thread not found');
        threadId = t.id;
      } else {
        threadId = newId();
        const singleSource = spec.scope?.sourceIds?.length === 1 ? spec.scope.sourceIds[0] : null;
        const scopeId = newId();
        await this.prisma.contextScope.create({ data: { id: scopeId, workspaceId, projectId: spec.scope?.projectId ?? null, sourceVersionIds: svids } });
        await this.prisma.thread.create({
          data: {
            id: threadId,
            workspaceId,
            projectId: spec.scope?.projectId ?? null,
            sourceId: singleSource,
            title: question.slice(0, 80),
            contextScopeId: scopeId,
            createdById: user.id,
          },
        });
      }
      let parent = spec.parentMessageId && isUuid(spec.parentMessageId) ? spec.parentMessageId : null;
      if (parent) {
        const pm = await this.prisma.message.findFirst({ where: { id: parent, threadId, workspaceId } });
        if (!pm) throw new NotFoundException('Parent message not found');
      } else {
        const last = await this.prisma.message.findFirst({ where: { threadId, workspaceId }, orderBy: { createdAt: 'desc' } });
        parent = last?.id ?? null;
      }
      userMessageId = newId();
      assistantMessageId = newId();
      await this.prisma.message.create({
        data: { id: userMessageId, workspaceId, threadId, parentMessageId: parent, role: 'USER', content: question },
      });
    }

    const inputText = [spec.input.question, spec.input.text].filter(Boolean).join('\n');
    const estimate = await this.preflightEstimate(plan.primary.modelConfigId, inputText, plan.maxOutputTokens);

    await this.prisma.aiRun.create({
      data: {
        id: runId,
        workspaceId,
        userId: user.id,
        threadId,
        messageId: assistantMessageId,
        graph: spec.graph,
        tier,
        status: 'QUEUED',
        input: spec.input as any,
        scope: { ...spec.scope, sourceVersionIds: svids } as any,
        modelPlan: plan as any,
        options: (spec.options ?? {}) as any,
        isDemo: plan.isDemo,
        lab: !!spec.lab,
        parentRunId: spec.parentRunId ?? null,
        forkedFromCheckpoint: spec.forkedFromCheckpoint ?? null,
      },
    });

    const reservation = await this.budgets.reserve(workspaceId, runId, estimate.amount);
    if (!reservation.ok) {
      await this.prisma.aiRun.update({
        where: { id: runId },
        data: {
          status: 'BUDGET_REJECTED',
          finishedAt: new Date(),
          error: { code: 'BUDGET', message: 'Budget limit reached before any model call', estimate: estimate.amount.toFixed(8), remaining: reservation.remaining, limit: reservation.limit },
        },
      });
      return { runId, threadId, userMessageId, messageId: null, status: 'BUDGET_REJECTED', estimate: estimate.amount.toFixed(8), remaining: reservation.remaining };
    }

    await this.prisma.costEntry.create({
      data: {
        id: newId(),
        workspaceId,
        userId: user.id,
        runId,
        modelConfigId: plan.primary.modelConfigId,
        entryType: 'ESTIMATE',
        tier: 'PREFLIGHT_ESTIMATE',
        amount: estimate.amount.toFixed(8),
        reason: estimate.priced ? null : 'PRICE_MISSING',
        feature: spec.graph,
        isDemo: estimate.isDemo,
      },
    });
    const planWithReservation = { ...plan, reservation: { reservationId: reservation.reservationId, amount: estimate.amount.toFixed(8), currency: 'USD' } };
    await this.prisma.aiRun.update({ where: { id: runId }, data: { modelPlan: planWithReservation as any } });

    if (assistantMessageId && threadId) {
      await this.prisma.message.create({
        data: { id: assistantMessageId, workspaceId, threadId, parentMessageId: userMessageId, role: 'ASSISTANT', content: '', status: 'STREAMING', aiRunId: runId },
      });
    }
    await this.queues.queue(QUEUES.runs).add('run', { runId }, { jobId: runId, attempts: 1 });
    return { runId, threadId, userMessageId, messageId: assistantMessageId, status: 'QUEUED', estimate: estimate.amount.toFixed(8), model: plan.primary };
  }

  async cancel(workspaceId: string, runId: string) {
    const run = await this.getRun(workspaceId, runId);
    if (TERMINAL.has(run.status)) return { status: run.status };
    await this.redis.client.set(CANCEL_KEY(runId), '1', 'EX', 3600);
    if (run.status === 'QUEUED') {
      const updated = await this.prisma.aiRun.updateMany({ where: { id: runId, status: 'QUEUED' }, data: { status: 'CANCELLED', finishedAt: new Date() } });
      if (updated.count) {
        await this.budgets.releaseRun(runId);
        if (run.messageId) await this.prisma.message.update({ where: { id: run.messageId }, data: { status: 'FAILED', content: '' } });
        await this.events.publishRun(runId, this.events.envelope('run.finished', { status: 'CANCELLED', outcome: 'PARTIAL' }, { runId, seq: run.lastSeq + 1 }));
        return { status: 'CANCELLED' };
      }
    }
    return { status: 'CANCELLING' };
  }

  async receipt(workspaceId: string, runId: string) {
    const run = await this.getRun(workspaceId, runId);
    const [calls, usage, totals, retrieval, citations, nodes] = await Promise.all([
      this.prisma.modelCall.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.usageEvent.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } }),
      this.ledger.runTotals(runId),
      this.prisma.retrievalEvent.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } }),
      run.messageId ? this.prisma.messageCitation.findMany({ where: { messageId: run.messageId } }) : Promise.resolve([]),
      this.prisma.nodeExecution.findMany({ where: { runId }, orderBy: [{ step: 'asc' }] }),
    ]);
    const tokens = usage.reduce(
      (a, u) => ({
        input: a.input + u.inputTokens,
        output: a.output + u.outputTokens,
        cachedInput: a.cachedInput + u.cachedInputTokens,
        reasoning: a.reasoning + u.reasoningTokens,
      }),
      { input: 0, output: 0, cachedInput: 0, reasoning: 0 },
    );
    const citationSummary = citations.reduce<Record<string, number>>((a, c) => ({ ...a, [c.state]: (a[c.state] ?? 0) + 1 }), {});
    const durationMs = run.startedAt && run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null;
    return {
      run: {
        id: run.id,
        graph: run.graph,
        tier: run.tier,
        status: run.status,
        outcome: run.outcome,
        isDemo: run.isDemo,
        lab: run.lab,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs,
        error: run.error,
        parentRunId: run.parentRunId,
      },
      modelPlan: run.modelPlan,
      modelCalls: calls,
      tokens,
      cost: { total: totals.total, estimate: totals.estimate, tier: totals.tier, currency: 'USD', isDemo: totals.isDemo, entries: totals.entries },
      retrieval: retrieval.map((r) => ({ id: r.id, query: r.query, params: r.params, candidates: (r.candidates as any[])?.length ?? 0, packed: (r.packed as any[])?.length ?? 0, latencyMs: r.latencyMs })),
      citations: { total: citations.length, byState: citationSummary },
      nodes: nodes.map((n) => ({ node: n.node, step: n.step, status: n.status, durationMs: n.durationMs })),
      traceUrl: `/app/studio/runs/${run.id}`,
    };
  }

  async trace(workspaceId: string, runId: string) {
    const run = await this.getRun(workspaceId, runId);
    const [events, nodes, retrieval, calls] = await Promise.all([
      this.prisma.aiRunEvent.findMany({ where: { runId }, orderBy: { seq: 'asc' } }),
      this.prisma.nodeExecution.findMany({ where: { runId }, orderBy: { step: 'asc' } }),
      this.prisma.retrievalEvent.findMany({ where: { runId } }),
      this.prisma.modelCall.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { run, events, nodes, retrieval, modelCalls: calls };
  }

  async list(workspaceId: string, q: { graph?: string; status?: string; lab?: string; limit?: number }) {
    return this.prisma.aiRun.findMany({
      where: {
        workspaceId,
        ...(q.graph ? { graph: q.graph } : {}),
        ...(q.status ? { status: q.status as any } : {}),
        ...(q.lab ? { lab: q.lab === 'true' } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(q.limit ?? 50, 200),
      select: {
        id: true,
        graph: true,
        tier: true,
        status: true,
        outcome: true,
        isDemo: true,
        lab: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        input: true,
        modelPlan: true,
        parentRunId: true,
        threadId: true,
      },
    });
  }

  /** Remaining budget for display in preflight cards. */
  async budgetStatus(workspaceId: string) {
    const cur = await this.budgets.currentPeriod(workspaceId);
    if (!cur) return null;
    const p = cur.period;
    const remaining = new Decimal(p.limitAmount.toString()).minus(p.spentFinal.toString()).minus(p.reservedOpen.toString());
    return {
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      limit: p.limitAmount.toString(),
      spent: p.spentFinal.toString(),
      reserved: p.reservedOpen.toString(),
      remaining: remaining.toFixed(8),
      hard: cur.policy.hard,
      currency: cur.policy.currency,
    };
  }
}
