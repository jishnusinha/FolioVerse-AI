import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AiRun, EvaluationRun } from '@prisma/client';
import { randomInt } from 'node:crypto';
import type { AuthUser } from '../../common/auth.decorators';
import { isUuid, newId } from '../../common/ids';
import { env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';
import { QUEUES, QueuesService } from '../../infra/queues.service';
import { LedgerService } from '../ledger/ledger.service';
import { ModelsService } from '../models/models.service';
import { RunExecutorService } from '../runs/run-executor.service';
import { LAB_FAULTS, RunsService, TERMINAL } from '../runs/runs.service';
import { GoldenItem, listDatasets, loadDataset } from './datasets';
import { aggregate, EvalItemResult, EvalObservation, scoreItem } from './evaluation';

const FAULT_INFO: Record<(typeof LAB_FAULTS)[number], { label: string; effect: string }> = {
  provider_timeout: { label: 'Provider timeout', effect: 'The first model call times out. A fallback model is tried if the plan has one; otherwise the run fails (retryable).' },
  provider_429: { label: 'Rate limit (429)', effect: 'The first model call is rate limited. Same fallback rule as a timeout.' },
  malformed_output: { label: 'Malformed output', effect: 'The model returns a truncated answer with an unknown citation marker; citation validation marks the run PARTIAL.' },
  retrieval_down: { label: 'Vector store down', effect: 'Retrieval fails before any model call; the run fails with RETRIEVAL_UNAVAILABLE and costs nothing.' },
};
const LABELS = ['A', 'B', 'C', 'D'];

export interface BattleInput {
  runId: string;
  models: string[];
  question?: string;
}

export interface EvaluationInput {
  dataset: string;
  scope?: { projectId?: string; sourceIds?: string[]; sourceVersionIds?: string[] };
  modelPreference?: string;
  options?: { topK?: number; fusion?: string; rerank?: boolean; chunkLevel?: string; contextBudget?: number };
  judge?: boolean;
}

interface Contestant {
  label: string;
  runId: string;
  modelConfigId: string;
}

function shuffle<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const citationsOf = (run: Pick<AiRun, 'result'>) => (((run.result as any)?.citations ?? []) as any[]).map((c) => ({ marker: c.marker, state: c.state, page: c.anchor?.selectors?.page ?? null }));

@Injectable()
export class StudioService {
  private readonly log = new Logger(StudioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: RunsService,
    private readonly executor: RunExecutorService,
    private readonly ledger: LedgerService,
    private readonly models: ModelsService,
    private readonly queues: QueuesService,
  ) {}

  /** What the lab may do here: fault injection flag, usable chat models, golden datasets. */
  async capabilities() {
    const models = (await this.models.list()).filter((m) => m.available && m.capabilities.includes('chat'));
    return {
      labFaults: env().FV_LAB_FAULTS,
      faults: LAB_FAULTS.map((id) => ({ id, ...FAULT_INFO[id] })),
      models: models.map((m) => ({ id: m.id, displayName: m.displayName, provider: m.provider, isDemo: m.isDemo, isDefault: m.isDefault })),
      judge: { liveModel: models.some((m) => !m.isDemo) },
      datasets: listDatasets(),
    };
  }

  // ─────────────── compare ───────────────

  async compare(workspaceId: string, ids: string[]) {
    const unique = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
    if (unique.length < 2 || unique.length > 4) throw new BadRequestException({ message: 'Pick two to four runs to compare', code: 'COMPARE_COUNT' });
    return { runs: await Promise.all(unique.map((id) => this.snapshot(workspaceId, id))) };
  }

  private async snapshot(workspaceId: string, runId: string) {
    const receipt = await this.runs.receipt(workspaceId, runId);
    const run = await this.runs.getRun(workspaceId, runId);
    const [message, messageCitations, retrieval] = await Promise.all([
      run.messageId ? this.prisma.message.findFirst({ where: { id: run.messageId, workspaceId }, select: { content: true } }) : null,
      run.messageId ? this.prisma.messageCitation.findMany({ where: { messageId: run.messageId, workspaceId }, orderBy: { marker: 'asc' } }) : null,
      this.prisma.retrievalEvent.findFirst({ where: { runId, workspaceId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const citations = messageCitations
      ? messageCitations.map((c) => ({ marker: c.marker, state: c.state, page: (c.anchor as any)?.selectors?.page ?? null }))
      : citationsOf(run);
    const last = receipt.modelCalls.at(-1);
    return {
      run: {
        id: run.id,
        graph: run.graph,
        status: run.status,
        outcome: run.outcome,
        lab: run.lab,
        isDemo: run.isDemo,
        parentRunId: run.parentRunId,
        createdAt: run.createdAt,
        question: (run.input as any)?.question ?? null,
        options: run.options,
      },
      model: {
        planned: (run.modelPlan as any)?.primary ?? null,
        used: last ? { modelConfigId: last.modelConfigId, provider: last.provider, model: last.model } : null,
        attempts: receipt.modelCalls.length,
      },
      answer: message?.content ?? (run.result as any)?.answer ?? '',
      citations,
      cost: receipt.cost,
      tokens: receipt.tokens,
      durationMs: receipt.run.durationMs,
      retrieval: retrieval
        ? {
            params: retrieval.params,
            candidates: ((retrieval.candidates as any[]) ?? []).length,
            latencyMs: retrieval.latencyMs,
            packed: ((retrieval.packed as any[]) ?? []).map((p) => ({ marker: p.marker, page: p.page ?? null, level: p.level ?? null, tokens: p.tokens ?? null, sourceVersionId: p.sourceVersionId })),
          }
        : null,
    };
  }

  // ─────────────── Model Battle ───────────────

  async createBattle(workspaceId: string, user: Pick<AuthUser, 'id'>, input: BattleInput) {
    const source = await this.runs.getRun(workspaceId, input.runId);
    if (source.graph !== 'grounded_qa') throw new BadRequestException({ message: 'A battle starts from a grounded Q&A run', code: 'NOT_QA_RUN' });
    if (!TERMINAL.has(source.status)) throw new BadRequestException({ message: 'Wait for the source run to finish', code: 'RUN_ACTIVE' });
    const models = [...new Set(input.models)];
    if (models.length < 2 || models.length > 4) throw new BadRequestException({ message: 'Pick two to four different models', code: 'BATTLE_MODELS' });
    const usable = new Set((await this.models.list()).filter((m) => m.available && m.capabilities.includes('chat')).map((m) => m.id));
    if (models.some((m) => !usable.has(m))) throw new BadRequestException({ message: 'Requested model is not available', code: 'MODEL_UNAVAILABLE' });

    const ev = await this.prisma.retrievalEvent.findFirst({ where: { runId: source.id, workspaceId }, orderBy: { createdAt: 'asc' } });
    const packed = ((ev?.packed as any[]) ?? []).filter((p) => p?.chunkId);
    if (!packed.length) throw new BadRequestException({ message: 'This run retrieved no passages to freeze', code: 'NO_CONTEXT' });
    const context = packed.map((p) => ({ chunkId: p.chunkId, level: p.level ?? 'CHILD', marker: p.marker, page: p.page ?? null, sourceVersionId: p.sourceVersionId }));
    const question = (input.question ?? (source.input as any)?.question ?? '').trim().slice(0, 2000);
    if (!question) throw new BadRequestException({ message: 'A question is required', code: 'VALIDATION' });
    const svids = ((source.scope as any)?.sourceVersionIds ?? []) as string[];

    const battleId = newId();
    const contestants: Contestant[] = [];
    for (const [i, modelConfigId] of shuffle(models).entries()) {
      const r = await this.runs.create(workspaceId, user, {
        graph: 'grounded_qa',
        input: { question },
        scope: { sourceVersionIds: svids },
        modelPreference: modelConfigId,
        lab: true,
        detached: true,
        options: { frozenContext: context.map(({ chunkId, level }) => ({ chunkId, level })), frozenFrom: source.id, battleId },
        parentRunId: source.id,
      });
      contestants.push({ label: LABELS[i], runId: r.runId, modelConfigId });
    }
    await this.prisma.modelBattle.create({
      data: { id: battleId, workspaceId, createdById: user.id, question, sourceRunId: source.id, contestants: contestants as any, context: context as any },
    });
    return this.getBattle(workspaceId, battleId);
  }

  /** Blind until voted: models, run ids and costs are revealed only after the vote. */
  async getBattle(workspaceId: string, battleId: string) {
    if (!isUuid(battleId)) throw new NotFoundException();
    const b = await this.prisma.modelBattle.findFirst({ where: { id: battleId, workspaceId } });
    if (!b) throw new NotFoundException();
    const contestants = b.contestants as unknown as Contestant[];
    const revealed = !!b.winner;
    const runs = await this.prisma.aiRun.findMany({ where: { id: { in: contestants.map((c) => c.runId) }, workspaceId } });
    const configs = revealed ? await this.prisma.modelConfig.findMany({ where: { id: { in: contestants.map((c) => c.modelConfigId) } } }) : [];
    const out = await Promise.all(
      contestants.map(async (c) => {
        const r = runs.find((x) => x.id === c.runId);
        const done = !!r && TERMINAL.has(r.status);
        const cites = r && done ? citationsOf(r) : [];
        const base = {
          label: c.label,
          status: r?.status ?? 'FAILED',
          outcome: r?.outcome ?? null,
          answer: done ? ((r!.result as any)?.answer ?? '') : '',
          error: done ? ((r!.error as any)?.message ?? null) : null,
          citations: cites.map(({ marker, state }) => ({ marker, state })),
        };
        if (!revealed) return base;
        const receipt = await this.runs.receipt(workspaceId, c.runId);
        const cfg = configs.find((x) => x.id === c.modelConfigId);
        return {
          ...base,
          runId: c.runId,
          model: { id: c.modelConfigId, displayName: cfg?.displayName ?? c.modelConfigId, isDemo: cfg?.isDemo ?? false },
          cost: receipt.cost,
          tokens: receipt.tokens,
          durationMs: receipt.run.durationMs,
        };
      }),
    );
    return {
      id: b.id,
      question: b.question,
      sourceRunId: b.sourceRunId,
      createdAt: b.createdAt,
      context: (b.context as any[]).map(({ marker, page, level }) => ({ marker, page, level })),
      finished: out.every((c) => TERMINAL.has(c.status)),
      revealed,
      winner: b.winner,
      votedAt: b.votedAt,
      contestants: out,
    };
  }

  async vote(workspaceId: string, user: Pick<AuthUser, 'id'>, battleId: string, winner: string) {
    const b = await this.getBattle(workspaceId, battleId);
    if (b.revealed) throw new ConflictException({ message: 'This battle already has a vote', code: 'ALREADY_VOTED' });
    if (!b.finished) throw new ConflictException({ message: 'Wait for every answer to finish before voting', code: 'NOT_FINISHED' });
    if (![...b.contestants.map((c) => c.label), 'TIE'].includes(winner)) throw new BadRequestException({ message: 'Vote for one of the answers or a tie', code: 'INVALID_WINNER' });
    const n = await this.prisma.modelBattle.updateMany({ where: { id: battleId, workspaceId, winner: null }, data: { winner, votedById: user.id, votedAt: new Date() } });
    if (!n.count) throw new ConflictException({ message: 'This battle already has a vote', code: 'ALREADY_VOTED' });
    return this.getBattle(workspaceId, battleId);
  }

  async listBattles(workspaceId: string) {
    const rows = await this.prisma.modelBattle.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((b) => {
      const cs = b.contestants as unknown as Contestant[];
      return {
        id: b.id,
        question: b.question,
        createdAt: b.createdAt,
        contestants: cs.length,
        winner: b.winner,
        winnerModel: b.winner ? (cs.find((c) => c.label === b.winner)?.modelConfigId ?? null) : null,
      };
    });
  }

  // ─────────────── RAG evaluation ───────────────

  async createEvaluation(workspaceId: string, user: Pick<AuthUser, 'id'>, input: EvaluationInput) {
    const ds = loadDataset(input.dataset);
    if (!ds) throw new BadRequestException({ message: 'Unknown evaluation dataset', code: 'UNKNOWN_DATASET' });
    const svids = await this.runs.resolveScope(workspaceId, input.scope ?? {});
    if (!svids.length) throw new BadRequestException({ message: 'No ready sources in scope. Wait for ingestion to finish or pick other sources.', code: 'EMPTY_SCOPE' });
    const target = await this.targetVersion(workspaceId, svids, ds.doc);
    if (!target) {
      throw new BadRequestException({ message: `This dataset asks about ${ds.doc}. Include that document (datasets/synthetic/docs) in the scope.`, code: 'EVAL_DOC_MISSING' });
    }
    const plan = await this.models.resolvePlan(input.modelPreference);
    const o = input.options ?? {};
    const options = Object.fromEntries(
      Object.entries({ topK: o.topK, fusion: o.fusion, rerank: o.rerank, chunkLevel: o.chunkLevel, contextBudget: o.contextBudget }).filter(([, v]) => v !== undefined),
    );
    const row = await this.prisma.evaluationRun.create({
      data: {
        id: newId(),
        workspaceId,
        requestedById: user.id,
        dataset: ds.id,
        scope: { sourceVersionIds: svids, targetVersionId: target },
        modelConfigId: plan.primary.modelConfigId,
        options,
        judge: !!input.judge,
        isDemo: plan.isDemo,
      },
    });
    await this.queues.queue(QUEUES.maintenance).add('rag-eval', { evaluationId: row.id }, { attempts: 1, jobId: `rag-eval-${row.id}` });
    return this.view(row);
  }

  private async targetVersion(workspaceId: string, svids: string[], doc: string) {
    const versions = await this.prisma.sourceVersion.findMany({ where: { id: { in: svids }, workspaceId }, select: { id: true, sourceId: true } });
    const sources = await this.prisma.source.findMany({ where: { id: { in: versions.map((v) => v.sourceId) }, workspaceId }, select: { id: true, title: true } });
    const stem = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, '');
    const match = sources.find((s) => stem(s.title) === stem(doc));
    return match ? (versions.find((v) => v.sourceId === match.id)?.id ?? null) : null;
  }

  async listEvaluations(workspaceId: string) {
    const rows = await this.prisma.evaluationRun.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((r) => this.view(r, false));
  }

  async getEvaluation(workspaceId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException();
    const row = await this.prisma.evaluationRun.findFirst({ where: { id, workspaceId } });
    if (!row) throw new NotFoundException();
    return this.view(row);
  }

  private view(r: EvaluationRun, withItems = true) {
    const total = loadDataset(r.dataset)?.items.length ?? null;
    const done = Array.isArray(r.items) ? r.items.length : 0;
    return {
      id: r.id,
      status: r.status,
      dataset: r.dataset,
      modelConfigId: r.modelConfigId,
      options: r.options,
      judge: r.judge,
      isDemo: r.isDemo,
      progress: { done, total },
      metrics: r.metrics,
      error: r.error,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      ...(withItems ? { items: r.items ?? [], runIds: r.runIds } : {}),
    };
  }

  /** Worker job: one detached lab run per golden item, executed inline so results are read back deterministically. */
  async runEvaluation(evaluationId: string) {
    const claimed = await this.prisma.evaluationRun.updateMany({ where: { id: evaluationId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
    if (!claimed.count) return;
    const row = await this.prisma.evaluationRun.findUniqueOrThrow({ where: { id: evaluationId } });
    try {
      const ds = loadDataset(row.dataset);
      if (!ds) throw new Error('Evaluation dataset not found');
      const items: EvalItemResult[] = [];
      const runIds: string[] = [];
      for (const item of ds.items) {
        const obs = await this.evaluateItem(row, item);
        if (obs.runId) runIds.push(obs.runId);
        items.push(scoreItem(item, obs));
        await this.prisma.evaluationRun.update({ where: { id: row.id }, data: { items: items as any, runIds } });
      }
      await this.prisma.evaluationRun.update({
        where: { id: row.id },
        data: { status: 'SUCCEEDED', metrics: aggregate(items) as any, finishedAt: new Date() },
      });
    } catch (e) {
      this.log.error(`evaluation ${row.id} failed: ${(e as Error).name}`);
      await this.prisma.evaluationRun.update({
        where: { id: row.id },
        data: { status: 'FAILED', error: ((e as any)?.response?.message ?? (e as Error).message ?? 'Evaluation failed').toString().slice(0, 300), finishedAt: new Date() },
      });
    }
  }

  private async execute(row: EvaluationRun, spec: Parameters<RunsService['create']>[2]) {
    const created = await this.runs.create(row.workspaceId, { id: row.requestedById }, spec, { enqueue: false });
    if (created.status === 'QUEUED') await this.executor.execute(created.runId);
    const usage = await this.prisma.usageEvent.findMany({ where: { runId: created.runId, processedAt: null }, select: { id: true } });
    for (const u of usage) await this.ledger.processUsageEvent(u.id);
    const run = await this.prisma.aiRun.findUniqueOrThrow({ where: { id: created.runId } });
    return { run, cost: Number((await this.ledger.runTotals(run.id)).total) };
  }

  private async evaluateItem(row: EvaluationRun, item: GoldenItem): Promise<EvalObservation> {
    const scope = row.scope as { sourceVersionIds: string[]; targetVersionId: string };
    const { run, cost } = await this.execute(row, {
      graph: 'grounded_qa',
      input: { question: item.question },
      scope: { sourceVersionIds: scope.sourceVersionIds },
      modelPreference: row.modelConfigId,
      lab: true,
      detached: true,
      options: { ...(row.options as object), evaluationId: row.id },
    });
    const answer = ((run.result as any)?.answer ?? '') as string;
    const ev = await this.prisma.retrievalEvent.findFirst({ where: { runId: run.id }, orderBy: { createdAt: 'asc' } });
    let relevance: number | null = null;
    let judgeCost = 0;
    if (row.judge && answer && run.outcome && run.outcome !== 'ABSTAINED') {
      const judged = await this.execute(row, {
        graph: 'answer_judge',
        input: { question: item.question, text: answer },
        modelPreference: row.modelConfigId,
        lab: true,
        options: { evaluationId: row.id },
        parentRunId: run.id,
      });
      judgeCost = judged.cost;
      try {
        const v = JSON.parse((judged.run.result as any)?.answer ?? '');
        relevance = Number.isInteger(v.score) ? v.score : null;
      } catch {
        relevance = null;
      }
    }
    return {
      runId: run.id,
      status: run.status,
      outcome: run.outcome,
      answer,
      citations: citationsOf(run),
      packed: ((ev?.packed as any[]) ?? []).map((p) => ({ sourceVersionId: p.sourceVersionId, page: p.page ?? null, pageFrom: p.pageFrom ?? null, pageTo: p.pageTo ?? null })),
      targetVersionId: scope.targetVersionId,
      cost,
      latencyMs: run.startedAt && run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
      relevance,
      judgeCost,
    };
  }
}
