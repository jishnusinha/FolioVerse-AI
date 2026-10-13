import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resetEnvCache } from '../../src/config/env';
import { newId } from '../../src/common/ids';
import { PrismaService } from '../../src/infra/prisma.service';
import { RedisService, RUN_STREAM } from '../../src/infra/redis.service';
import { BudgetService } from '../../src/modules/ledger/budget.service';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { RunExecutorService } from '../../src/modules/runs/run-executor.service';
import { createApp, registered } from './harness';

/**
 * Run lifecycle against a fake AI service that speaks the NDJSON work-unit protocol. Like the
 * Python service, it writes usage_events itself and reports them with `usage.recorded`.
 */
let app: INestApplication;
let prisma: PrismaService;
let ai: Server;
const seen: { auth?: string; body: any }[] = [];

const ANSWER = ['The base case ', 'projects 14.2% ', 'annual growth ', '[S1].'];

function line(res: any, type: string, data: Record<string, unknown>) {
  res.write(JSON.stringify({ schemaVersion: 1, type, ts: new Date().toISOString(), data }) + '\n');
}

async function grounded(res: any, body: any) {
  const svid = body.input.params?.svid;
  line(res, 'node.started', { node: 'resolve_scope', step: 1 });
  line(res, 'node.finished', { node: 'resolve_scope', step: 1, status: 'SUCCEEDED', durationMs: 3 });
  line(res, 'retrieval.completed', { candidates: 4, packed: 2 });
  if (body.input.question.includes('Antarctica')) {
    line(res, 'run.finished', { status: 'SUCCEEDED', outcome: 'ABSTAINED', answer: 'I could not find evidence for that in the selected sources.' });
    return res.end();
  }
  line(res, 'node.started', { node: 'generate', step: 2 });
  for (const t of ANSWER) line(res, 'token.delta', { text: t });
  if (body.input.question.includes('slowly')) {
    // Held open until the API aborts the request (cancellation).
    await new Promise((r) => res.on('close', r));
    return;
  }
  const modelCallId = newId();
  const usageEventId = newId();
  await prisma.usageEvent.create({
    data: {
      id: usageEventId,
      workspaceId: body.workspaceId,
      runId: body.runId,
      modelCallId,
      modelConfigId: 'mock-grounded',
      provider: 'mock',
      model: 'folioverse-mock-1',
      inputTokens: 1200,
      outputTokens: 80,
      isDemo: true,
      feature: 'grounded_qa',
    },
  });
  line(res, 'usage.recorded', { modelCallId, usageEventId, modelConfigId: 'mock-grounded', provider: 'mock', model: 'folioverse-mock-1', latencyMs: 12 });
  line(res, 'node.finished', { node: 'generate', step: 2, status: 'SUCCEEDED', durationMs: 40 });
  line(res, 'citation.validated', {
    marker: 'S1',
    state: 'VALID',
    score: 0.92,
    quote: 'grows at a compound annual rate of 14.2%',
    anchor: { sourceVersionId: svid, chunkId: newId(), selectors: { page: 1 } },
  });
  line(res, 'run.finished', { status: 'SUCCEEDED', outcome: 'ANSWERED', answer: ANSWER.join('') });
  res.end();
}

beforeAll(async () => {
  ai = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ auth: req.headers.authorization, body });
      if (req.url !== '/internal/runs/units') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      await grounded(res, body);
    });
  });
  await new Promise<void>((r) => ai.listen(0, '127.0.0.1', r));
  process.env.FV_AI_API_URL = `http://127.0.0.1:${(ai.address() as AddressInfo).port}`;
  resetEnvCache();
  app = await createApp();
  prisma = app.get(PrismaService);
  await app.get(ModelsService).ensureSeeded();
});
afterAll(async () => {
  await app?.close();
  await new Promise((r) => ai?.close(r));
});

async function readyWorkspace(label: string) {
  const u = await registered(app, label);
  const project = u.projects.find((p) => p.kind === 'KNOWLEDGE');
  const bytes = Buffer.from('# Atlas\n\nGrowth is 14.2% in the base case.');
  const up = await u.c.post(`/api/workspaces/${u.workspaceId}/uploads`, { projectId: project.id, filename: 'atlas.md', sizeBytes: bytes.length });
  await u.c.send('put', up.body.url, bytes, { 'content-type': up.body.headers['Content-Type'] });
  const done = await u.c.post(`/api/workspaces/${u.workspaceId}/uploads/${up.body.uploadId}/complete`, {});
  await prisma.sourceVersion.update({ where: { id: done.body.versionId }, data: { ingestionState: 'READY' } });
  return { ...u, sourceId: done.body.sourceId as string, versionId: done.body.versionId as string };
}

function ask(u: Awaited<ReturnType<typeof readyWorkspace>>, question: string, extra: Record<string, unknown> = {}) {
  return u.c.post(`/api/workspaces/${u.workspaceId}/runs`, {
    graph: 'grounded_qa',
    input: { question, params: { svid: u.versionId } },
    scope: { sourceIds: [u.sourceId] },
    ...extra,
  });
}

/** Parses an SSE body into events with their ids. */
function sse(text: string) {
  return text
    .split('\n\n')
    .map((block) => {
      const id = /^id: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      return id && data ? { id, ...JSON.parse(data) } : null;
    })
    .filter(Boolean) as any[];
}

describe('run lifecycle', () => {
  it('streams a grounded run to SUCCEEDED and persists messages, citations and milestones', async () => {
    const u = await readyWorkspace('runner');
    const created = await ask(u, 'What is the base-case growth?');
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'QUEUED' });
    const { runId, messageId, threadId } = created.body;

    await app.get(RunExecutorService).execute(runId);

    const call = seen.find((s) => s.body.runId === runId)!;
    expect(call.auth).toMatch(/^Bearer /);
    expect(call.body.scopeToken).toEqual(expect.any(String));

    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ status: 'SUCCEEDED', outcome: 'ANSWERED' });
    const msg = await prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: { citations: true } });
    expect(msg).toMatchObject({ content: ANSWER.join(''), status: 'COMPLETE', threadId });
    expect(msg.citations).toEqual([expect.objectContaining({ marker: 'S1', state: 'VALID', sourceVersionId: u.versionId })]);

    const types = (await prisma.aiRunEvent.findMany({ where: { runId }, orderBy: { seq: 'asc' } })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['run.state', 'node.started', 'node.finished', 'retrieval.completed', 'usage.recorded', 'citation.validated', 'run.finished']));
    expect(types).not.toContain('token.delta');
    expect(await prisma.nodeExecution.count({ where: { runId } })).toBe(2);
    expect(await prisma.modelCall.count({ where: { runId } })).toBe(1);

    // Ledger worker: usage → FINAL cost entry, then settle releases the reservation.
    const usage = await prisma.usageEvent.findFirstOrThrow({ where: { runId } });
    await app.get(LedgerService).processUsageEvent(usage.id);
    await app.get(BudgetService).releaseRun(runId);
    expect(await prisma.budgetReservation.count({ where: { runId, status: 'OPEN' } })).toBe(0);

    const receipt = await u.c.get(`/api/workspaces/${u.workspaceId}/runs/${runId}/receipt`);
    expect(receipt.status).toBe(200);
    const finals = await prisma.costEntry.findMany({ where: { runId, entryType: 'FINAL' } });
    const sum = finals.reduce((a, e) => a + Number(e.amount), 0);
    expect(Number(receipt.body.cost.total)).toBeCloseTo(sum, 8);
    expect(receipt.body).toMatchObject({ tokens: { input: 1200, output: 80 }, citations: { total: 1, byState: { VALID: 1 } } });
    expect(receipt.body.cost).toMatchObject({ tier: 'FINALIZED', isDemo: true });
  });

  it('resumes the event stream after Last-Event-ID without duplicates', async () => {
    const u = await readyWorkspace('resume');
    const { runId } = (await ask(u, 'Resume me')).body;
    await app.get(RunExecutorService).execute(runId);
    const path = `/api/workspaces/${u.workspaceId}/runs/${runId}/events`;

    const full = sse((await u.c.get(path)).text);
    const tokens = full.filter((e) => e.type === 'token.delta');
    expect(tokens.map((t) => t.data.text).join('')).toBe(ANSWER.join(''));
    expect(full.at(-1).type).toBe('run.finished');

    const cut = full.indexOf(tokens[1]);
    const rest = sse((await u.c.send('get', path, undefined, { 'last-event-id': full[cut].id })).text);
    expect(rest.map((e) => e.id)).toEqual(full.slice(cut + 1).map((e) => e.id));
    expect(new Set(full.map((e) => e.id)).size).toBe(full.length);
  });

  it('abstains without a model call', async () => {
    const u = await readyWorkspace('abstain');
    const { runId, messageId } = (await ask(u, 'What about pricing in Antarctica?')).body;
    await app.get(RunExecutorService).execute(runId);
    expect(await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({ status: 'SUCCEEDED', outcome: 'ABSTAINED' });
    expect(await prisma.modelCall.count({ where: { runId } })).toBe(0);
    expect(await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).toMatchObject({ status: 'ABSTAINED' });
    const receipt = await u.c.get(`/api/workspaces/${u.workspaceId}/runs/${runId}/receipt`);
    expect(receipt.body.cost).toMatchObject({ tier: 'FINALIZED', total: '0.00000000' });
  });

  it('hides runs, receipts, events and threads from other users', async () => {
    const a = await readyWorkspace('tenant-a');
    const b = await registered(app, 'tenant-b');
    const { runId, threadId } = (await ask(a, 'What is the base-case growth?')).body;
    for (const w of [a.workspaceId, b.workspaceId]) {
      for (const p of [`runs/${runId}`, `runs/${runId}/receipt`, `runs/${runId}/trace`, `runs/${runId}/events`, `threads/${threadId}`]) {
        const res = await b.c.get(`/api/workspaces/${w}/${p}`);
        expect({ p, w, status: res.status }).toEqual({ p, w, status: 404 });
      }
    }
    expect((await b.c.get(`/api/workspaces/${b.workspaceId}/threads`)).body).toEqual([]);
  });

  it('files a version-scoped conversation under its document and project', async () => {
    const u = await readyWorkspace('threads');
    const { threadId } = (await ask(u, 'What is the base-case growth?', { scope: { sourceVersionIds: [u.versionId] } })).body;
    const listed = await u.c.get(`/api/workspaces/${u.workspaceId}/threads?sourceId=${u.sourceId}`);
    expect(listed.body.map((t: any) => t.id)).toEqual([threadId]);
    const source = await prisma.source.findUniqueOrThrow({ where: { id: u.sourceId } });
    expect(listed.body[0]).toMatchObject({ sourceId: u.sourceId, projectId: source.projectId });
  });

  it('cancels a streaming run and releases its reservation', async () => {
    const u = await readyWorkspace('cancel');
    const { runId } = (await ask(u, 'Answer slowly please')).body;
    const exec = app.get(RunExecutorService).execute(runId);
    for (let i = 0; i < 50; i++) {
      const r = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } });
      if (r.status === 'STREAMING') break;
      await new Promise((res) => setTimeout(res, 50));
    }
    const res = await u.c.post(`/api/workspaces/${u.workspaceId}/runs/${runId}/cancel`);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('CANCELLING');
    await exec;
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('CANCELLED');
    await app.get(BudgetService).releaseRun(runId);
    expect(await prisma.budgetReservation.count({ where: { runId, status: 'OPEN' } })).toBe(0);
  });

  it('reaper marks runs from a dead worker INTERRUPTED and frees the reservation', async () => {
    const u = await readyWorkspace('crash');
    const { runId, messageId } = (await ask(u, 'Interrupted question')).body;
    // A worker claimed the run, then died: status RUNNING with a stale heartbeat.
    await prisma.aiRun.update({ where: { id: runId }, data: { status: 'RUNNING', startedAt: new Date(), heartbeatAt: new Date(Date.now() - 120_000) } });
    expect(await prisma.budgetReservation.count({ where: { runId, status: 'OPEN' } })).toBe(1);

    expect(await app.get(RunExecutorService).reap()).toBeGreaterThanOrEqual(1);

    expect(await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({ status: 'INTERRUPTED' });
    expect(await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).toMatchObject({ status: 'FAILED' });
    expect(await prisma.budgetReservation.count({ where: { runId, status: 'OPEN' } })).toBe(0);
    const entries = await app.get(RedisService).client.xrange(RUN_STREAM(runId), '-', '+');
    const states = entries.map(([, f]) => JSON.parse(f[1])).filter((e) => e.type === 'run.state');
    expect(states.at(-1).data.status).toBe('INTERRUPTED');
  });

  it('rejects a run over a hard budget before any model call', async () => {
    const u = await readyWorkspace('budget');
    const budgets = app.get(BudgetService);
    const cur = await budgets.currentPeriod(u.workspaceId);
    await prisma.budgetPolicy.update({ where: { id: cur!.policy.id }, data: { hard: true } });
    await prisma.budgetPeriod.update({ where: { id: cur!.period.id }, data: { limitAmount: '0.00000001' } });
    const res = await ask(u, 'Too expensive');
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('BUDGET_REJECTED');
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: res.body.runId } });
    expect(run.status).toBe('BUDGET_REJECTED');
    expect(seen.some((s) => s.body.runId === res.body.runId)).toBe(false);
  });

  it('hands the graph a budget guard only under a hard budget', async () => {
    const u = await readyWorkspace('guard');
    const cur = await app.get(BudgetService).currentPeriod(u.workspaceId);
    await prisma.budgetPolicy.update({ where: { id: cur!.policy.id }, data: { hard: false } });
    const soft = await ask(u, 'What growth is projected?');
    const softRun = await prisma.aiRun.findUniqueOrThrow({ where: { id: soft.body.runId } });
    expect((softRun.modelPlan as any).budgetGuard).toBeUndefined();

    await prisma.budgetPolicy.update({ where: { id: cur!.policy.id }, data: { hard: true } });
    const hard = await ask(u, 'What growth is projected?');
    expect(hard.body.status).toBe('QUEUED');
    const plan = (await prisma.aiRun.findUniqueOrThrow({ where: { id: hard.body.runId } })).modelPlan as any;
    const maxCost = Number(plan.budgetGuard.maxCost);
    expect(maxCost).toBeGreaterThanOrEqual(Number(plan.reservation.amount));
    expect(maxCost).toBeLessThanOrEqual(Number(cur!.period.limitAmount.toString()));
    expect(plan.budgetGuard.prices.inputPerMTok).toBeTruthy();
  });
});

/** Own app instance: registration is rate limited per app. */
describe('multi-scope budgets', () => {
  beforeAll(async () => {
    await app.close();
    app = await createApp();
    prisma = app.get(PrismaService);
  });

  it('a project budget rejects runs in that project and gives back the workspace reservation', async () => {
    const u = await readyWorkspace('projbudget');
    const project = u.projects.find((p) => p.kind === 'KNOWLEDGE');
    const created = await u.c.post(`/api/workspaces/${u.workspaceId}/budgets`, { scope: 'PROJECT', scopeRefId: project.id, limitAmount: '0.00000001', hard: true });
    expect(created.status).toBe(201);
    const ws = await app.get(BudgetService).currentPeriod(u.workspaceId);
    await prisma.budgetPolicy.update({ where: { id: ws!.policy.id }, data: { hard: true } });

    const res = await ask(u, 'Too expensive for the project');
    expect(res.body.status).toBe('BUDGET_REJECTED');
    expect(res.body.budget).toMatchObject({ scope: 'PROJECT', policyId: created.body.id });
    expect(await prisma.budgetReservation.count({ where: { runId: res.body.runId, status: 'OPEN' } })).toBe(0);
    const period = await prisma.budgetPeriod.findUniqueOrThrow({ where: { id: ws!.period.id } });
    expect(period.reservedOpen.toString()).toBe('0');
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: res.body.runId } });
    expect(run.error).toMatchObject({ code: 'BUDGET', scope: 'PROJECT' });
  });

  it('a user budget is reserved and charged alongside the workspace budget', async () => {
    const u = await readyWorkspace('userbudget');
    const created = await u.c.post(`/api/workspaces/${u.workspaceId}/budgets`, { scope: 'USER', scopeRefId: u.userId, limitAmount: '0.05', hard: true, alertThresholds: [1] });
    expect(created.status).toBe(201);
    const { runId } = (await ask(u, 'What is the base-case growth?')).body;
    const held = await prisma.budgetReservation.findMany({ where: { runId, status: 'OPEN' } });
    const periods = await prisma.budgetPeriod.findMany({ where: { id: { in: held.map((r) => r.periodId) } } });
    expect(periods.map((p) => p.policyId).sort()).toEqual([created.body.id, (await app.get(BudgetService).currentPeriod(u.workspaceId))!.policy.id].sort());

    await app.get(RunExecutorService).execute(runId);
    const usage = await prisma.usageEvent.findFirstOrThrow({ where: { runId } });
    await app.get(LedgerService).processUsageEvent(usage.id);
    await app.get(BudgetService).releaseRun(runId);
    const list = (await u.c.get(`/api/workspaces/${u.workspaceId}/budgets`)).body as any[];
    const mine = list.find((b) => b.id === created.body.id);
    expect(Number(mine.current.spent)).toBeGreaterThan(0);
    expect(Number(mine.current.reserved)).toBe(0);
    expect(mine.label).toContain('userbudget');
    expect(mine.current.alertsSent).toContain(1);
    const alerts = await prisma.notification.findMany({ where: { workspaceId: u.workspaceId, kind: 'BUDGET_ALERT' } });
    expect(alerts).toEqual([expect.objectContaining({ userId: u.userId, title: expect.stringContaining('userbudget’s AI budget 1% used') })]);

    // Tighten the user budget below what one run costs: the next run is rejected at USER scope.
    await u.c.patch(`/api/workspaces/${u.workspaceId}/budgets/${created.body.id}`, { limitAmount: mine.current.spent });
    const again = await ask(u, 'What is the base-case growth?');
    expect(again.body).toMatchObject({ status: 'BUDGET_REJECTED', budget: { scope: 'USER' } });
  });
});
