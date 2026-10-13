import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { newId } from '../../src/common/ids';
import { resetEnvCache } from '../../src/config/env';
import { PrismaService } from '../../src/infra/prisma.service';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { RunExecutorService } from '../../src/modules/runs/run-executor.service';
import { loadDataset } from '../../src/modules/studio/datasets';
import { StudioService } from '../../src/modules/studio/studio.service';
import { createApp, registered } from './harness';

/**
 * Gate 8 AI Studio: lab run rules, checkpoint get, run compare, blind Model Battle on a frozen context and the
 * golden-set RAG evaluation job, against a fake AI service that records retrieval and usage like the real one.
 */
let app: INestApplication;
let prisma: PrismaService;
let ai: Server;
const units: any[] = [];
const dataset = loadDataset('qa-small')!;

function line(res: any, type: string, data: Record<string, unknown>) {
  res.write(JSON.stringify({ schemaVersion: 1, type, ts: new Date().toISOString(), data }) + '\n');
}

const svidsOf = (token: string): string[] => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).svids;

async function usage(body: any) {
  const id = newId();
  const modelCallId = newId();
  const ref = body.modelPlan.primary;
  await prisma.usageEvent.create({
    data: { id, workspaceId: body.workspaceId, runId: body.runId, modelCallId, modelConfigId: ref.modelConfigId, provider: 'mock', model: ref.model, inputTokens: 1000, outputTokens: 60, isDemo: true, feature: body.graph },
  });
  return { usageEventId: id, modelCallId, modelConfigId: ref.modelConfigId, provider: 'mock', model: ref.model, attempt: 1, status: 'OK', latencyMs: 8 };
}

async function unit(res: any, body: any) {
  if (body.graph === 'answer_judge') {
    line(res, 'usage.recorded', await usage(body));
    line(res, 'run.finished', { status: 'SUCCEEDED', outcome: 'ANSWERED', answer: JSON.stringify({ score: 4, reason: 'Relevant (DEMO)' }) });
    return res.end();
  }
  const svid = svidsOf(body.scopeToken)[0];
  const item = dataset.items.find((i) => i.question === body.input.question);
  const frozen = body.options?.frozenContext as { chunkId: string; level: string }[] | undefined;
  const page = item?.page ?? 1;
  const packed = frozen
    ? frozen.map((f, i) => ({ marker: `S${i + 1}`, chunkId: f.chunkId, sourceVersionId: svid, page, level: f.level, tokens: 120 }))
    : [{ marker: 'S1', chunkId: newId(), sourceVersionId: svid, page, level: 'PARENT', tokens: 120 }];
  await prisma.retrievalEvent.create({
    data: {
      id: newId(),
      workspaceId: body.workspaceId,
      runId: body.runId,
      query: body.input.question,
      params: frozen ? { mode: 'frozen', frozenFrom: body.options.frozenFrom } : { mode: 'query', topK: body.options?.topK ?? 8, fusion: 'rrf' },
      candidates: packed.map((p, i) => ({ ...p, finalRank: i + 1, fusedRank: i + 1, note: 'packed-parent' })),
      packed,
      latencyMs: 9,
    },
  });
  line(res, 'retrieval.completed', { candidates: packed.length, packed: packed.length });
  if (item && !item.answerable) {
    line(res, 'run.finished', { status: 'SUCCEEDED', outcome: 'ABSTAINED', answer: 'I could not find evidence for that in the selected sources.' });
    return res.end();
  }
  const concise = String(body.modelPlan.primary.model).endsWith('-concise');
  const answer = concise ? `${item?.evidence ?? 'Growth'} [S1].` : `The brief says ${item?.evidence ?? '14.2%'} [S1].`;
  line(res, 'token.delta', { text: answer });
  line(res, 'usage.recorded', await usage(body));
  line(res, 'citation.validated', { marker: 'S1', state: 'VALID', score: 0.9, quote: item?.evidence ?? '14.2%', anchor: { sourceVersionId: svid, selectors: { page } } });
  line(res, 'run.finished', { status: 'SUCCEEDED', outcome: 'ANSWERED', answer });
  res.end();
}

beforeAll(async () => {
  ai = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const body = raw ? JSON.parse(raw) : {};
      const json = (status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
      if (req.url === '/internal/providers') return json(200, { available: ['mock'] });
      const cp = /^\/internal\/runs\/([\w-]+)\/checkpoints$/.exec(req.url ?? '');
      if (cp) {
        return json(200, {
          runId: cp[1],
          checkpoints: [
            { checkpointId: 'cp-0', parentCheckpointId: null, step: -1, source: 'input', next: ['__start__'], state: {} },
            { checkpointId: 'cp-1', parentCheckpointId: 'cp-0', step: 0, source: 'loop', next: ['retrieve'], state: { question: '<40 chars>' } },
          ],
        });
      }
      if (req.url !== '/internal/runs/units') return res.writeHead(404).end();
      units.push(body);
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      await unit(res, body);
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

async function workspace(label: string) {
  const u = await registered(app, label);
  const project = u.projects.find((p: any) => p.kind === 'KNOWLEDGE');
  const doc = async (filename: string) => {
    const bytes = Buffer.from('# Atlas brief\n\nThe base case projects 14.2% annual growth.\n');
    const up = await u.c.post(`/api/workspaces/${u.workspaceId}/uploads`, { projectId: project.id, filename, sizeBytes: bytes.length });
    await u.c.send('put', up.body.url, bytes, { 'content-type': up.body.headers['Content-Type'] });
    const done = await u.c.post(`/api/workspaces/${u.workspaceId}/uploads/${up.body.uploadId}/complete`, {});
    await prisma.sourceVersion.update({ where: { id: done.body.versionId }, data: { ingestionState: 'READY' } });
    return { sourceId: done.body.sourceId as string, versionId: done.body.versionId as string };
  };
  const atlas = await doc('atlas-brief.md');
  const other = await doc('notes.md');
  return { ...u, project, atlas, other, base: `/api/workspaces/${u.workspaceId}` };
}

async function askAndRun(w: Awaited<ReturnType<typeof workspace>>, question: string, extra: Record<string, unknown> = {}) {
  const res = await w.c.post(`${w.base}/runs`, { graph: 'grounded_qa', input: { question }, scope: { sourceIds: [w.atlas.sourceId] }, ...extra });
  expect(res.status).toBe(201);
  await app.get(RunExecutorService).execute(res.body.runId);
  for (const ev of await prisma.usageEvent.findMany({ where: { runId: res.body.runId } })) await app.get(LedgerService).processUsageEvent(ev.id);
  return res.body;
}

describe('ai studio (gate 8)', () => {
  it('reports capabilities and enforces lab-only run options', async () => {
    const w = await workspace('studio-caps');
    const caps = await w.c.get(`${w.base}/studio/capabilities`);
    expect(caps.status).toBe(200);
    expect(caps.body.models.map((m: any) => m.id)).toEqual(expect.arrayContaining(['mock-grounded', 'mock-concise']));
    expect(caps.body.faults.map((f: any) => f.id)).toEqual(['provider_timeout', 'provider_429', 'malformed_output', 'retrieval_down']);
    expect(caps.body.datasets).toEqual([expect.objectContaining({ id: 'qa-small', items: 12, answerable: 10, doc: 'atlas-brief.pdf' })]);
    expect(caps.body.judge).toEqual({ liveModel: false });
    const notebooks = caps.body.notebooks as { name: string; smoke: boolean; findings: string[] }[];
    expect(notebooks.map((n) => n.name)).toEqual(expect.arrayContaining(['03-hybrid-retrieval-rrf', '06-rag-evaluation']));
    expect(notebooks.every((n) => !n.smoke && n.findings.length > 0)).toBe(true);

    const q = { graph: 'grounded_qa', input: { question: 'What is the base-case annual growth rate between 2026 and 2030?' }, scope: { sourceIds: [w.atlas.sourceId] } };
    expect((await w.c.post(`${w.base}/runs`, { ...q, fallbackModels: ['mock-concise'] })).body.code).toBe('LAB_ONLY');
    expect((await w.c.post(`${w.base}/runs`, { ...q, detached: true })).body.code).toBe('LAB_ONLY');
    expect((await w.c.post(`${w.base}/runs`, { ...q, lab: true, fallbackModels: ['nope'] })).body.code).toBe('MODEL_UNAVAILABLE');

    const lab = await askAndRun(w, q.input.question, { lab: true, detached: true, fallbackModels: ['mock-concise'], options: { topK: 4, chunkLevel: 'child' } });
    expect(lab.threadId).toBeNull();
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: lab.runId } });
    expect(run).toMatchObject({ lab: true, threadId: null, messageId: null, status: 'SUCCEEDED' });
    expect((run.modelPlan as any).fallbacks.map((f: any) => f.modelConfigId)).toEqual(['mock-concise']);
    expect((run.result as any).citations[0]).toMatchObject({ marker: 'S1', state: 'VALID' });
    expect(units.at(-1).options).toMatchObject({ topK: 4, chunkLevel: 'child' });
    expect(await prisma.thread.count({ where: { workspaceId: w.workspaceId } })).toBe(0);

    const cp = await w.c.get(`${w.base}/runs/${lab.runId}/checkpoints/cp-1`);
    expect(cp.body).toMatchObject({ checkpointId: 'cp-1', next: ['retrieve'] });
    expect((await w.c.get(`${w.base}/runs/${lab.runId}/checkpoints/missing`)).status).toBe(404);

    const fork = await w.c.post(`${w.base}/runs/${lab.runId}/fork`, { checkpointId: 'cp-1', modelPreference: 'mock-concise' });
    expect(fork.status).toBe(201);
    expect(fork.body.threadId).toBeNull();
    expect(await prisma.aiRun.findUniqueOrThrow({ where: { id: fork.body.runId } })).toMatchObject({
      lab: true,
      threadId: null,
      parentRunId: lab.runId,
      forkedFromCheckpoint: 'cp-1',
    });
    expect(await prisma.thread.count({ where: { workspaceId: w.workspaceId } })).toBe(0);
  });

  it('compares runs side by side', async () => {
    const w = await workspace('studio-compare');
    const a = await askAndRun(w, dataset.items[0].question);
    const b = await askAndRun(w, dataset.items[0].question, { lab: true, detached: true, modelPreference: 'mock-concise' });
    const res = await w.c.get(`${w.base}/studio/compare?runs=${a.runId},${b.runId}`);
    expect(res.status).toBe(200);
    const [ra, rb] = res.body.runs;
    expect(ra).toMatchObject({ run: { id: a.runId, lab: false }, model: { used: { modelConfigId: 'mock-grounded' } }, citations: [{ marker: 'S1', state: 'VALID', page: 1 }] });
    expect(rb).toMatchObject({ run: { id: b.runId, lab: true }, model: { used: { modelConfigId: 'mock-concise' } }, answer: '14.2% [S1].' });
    expect(ra.answer).toContain('14.2%');
    expect(ra.retrieval.packed[0]).toMatchObject({ marker: 'S1', page: 1, level: 'PARENT' });
    expect(Number(ra.cost.total)).toBeGreaterThan(Number(rb.cost.total));
    expect((await w.c.get(`${w.base}/studio/compare?runs=${a.runId}`)).body.code).toBe('COMPARE_COUNT');

    const stranger = await workspace('studio-compare-x');
    expect((await stranger.c.get(`${stranger.base}/studio/compare?runs=${a.runId},${b.runId}`)).status).toBe(404);
  });

  it('runs a blind Model Battle on the frozen context and reveals models after one vote', async () => {
    const w = await workspace('studio-battle');
    const src = await askAndRun(w, dataset.items[1].question);
    const sourcePacked = (await prisma.retrievalEvent.findFirstOrThrow({ where: { runId: src.runId } })).packed as any[];

    expect((await w.c.post(`${w.base}/studio/battles`, { runId: src.runId, models: ['mock-grounded'] })).status).toBe(400);
    const created = await w.c.post(`${w.base}/studio/battles`, { runId: src.runId, models: ['mock-grounded', 'mock-concise'] });
    expect(created.status).toBe(201);
    const battle = created.body;
    expect(battle).toMatchObject({ question: dataset.items[1].question, finished: false, revealed: false, winner: null });
    expect(battle.context).toEqual([{ marker: 'S1', page: 1, level: 'PARENT' }]);
    expect(battle.contestants.map((c: any) => c.label)).toEqual(['A', 'B']);
    expect(battle.contestants[0]).not.toHaveProperty('model');
    expect(battle.contestants[0]).not.toHaveProperty('runId');
    expect((await w.c.post(`${w.base}/studio/battles/${battle.id}/vote`, { winner: 'A' })).body.code).toBe('NOT_FINISHED');

    const row = await prisma.modelBattle.findUniqueOrThrow({ where: { id: battle.id } });
    for (const c of row.contestants as any[]) await app.get(RunExecutorService).execute(c.runId);
    const frozenUnits = units.filter((u) => u.options?.battleId === battle.id);
    expect(frozenUnits).toHaveLength(2);
    expect(frozenUnits.every((u) => u.options.frozenContext[0].chunkId === sourcePacked[0].chunkId && u.options.frozenFrom === src.runId)).toBe(true);

    const ready = await w.c.get(`${w.base}/studio/battles/${battle.id}`);
    expect(ready.body.finished).toBe(true);
    expect(ready.body.contestants.every((c: any) => c.answer.includes('[S1]') && !c.model)).toBe(true);
    expect((await w.c.post(`${w.base}/studio/battles/${battle.id}/vote`, { winner: 'C' })).body.code).toBe('INVALID_WINNER');

    const voted = await w.c.post(`${w.base}/studio/battles/${battle.id}/vote`, { winner: 'B' });
    expect(voted.status).toBe(200);
    expect(voted.body).toMatchObject({ revealed: true, winner: 'B' });
    expect(new Set(voted.body.contestants.map((c: any) => c.model.id))).toEqual(new Set(['mock-grounded', 'mock-concise']));
    expect(voted.body.contestants.every((c: any) => c.cost && c.runId)).toBe(true);
    expect((await w.c.post(`${w.base}/studio/battles/${battle.id}/vote`, { winner: 'A' })).body.code).toBe('ALREADY_VOTED');

    const list = await w.c.get(`${w.base}/studio/battles`);
    expect(list.body[0]).toMatchObject({ id: battle.id, winner: 'B', winnerModel: (row.contestants as any[]).find((c) => c.label === 'B').modelConfigId });
    const stranger = await workspace('studio-battle-x');
    expect((await stranger.c.get(`${stranger.base}/studio/battles/${battle.id}`)).status).toBe(404);
  });

  it('evaluates the golden set with retrieval recall, faithfulness, abstention and an opt-in judge', async () => {
    const w = await workspace('studio-eval');
    const bad = await w.c.post(`${w.base}/studio/evaluations`, { dataset: 'qa-small', scope: { sourceIds: [w.other.sourceId] } });
    expect(bad.body.code).toBe('EVAL_DOC_MISSING');
    expect((await w.c.post(`${w.base}/studio/evaluations`, { dataset: 'nope', scope: { sourceIds: [w.atlas.sourceId] } })).body.code).toBe('UNKNOWN_DATASET');
    expect((await w.c.post(`${w.base}/studio/evaluations`, { dataset: 'qa-small', scope: { sourceIds: [w.atlas.sourceId] }, options: { topK: 99 } })).status).toBe(400);

    const created = await w.c.post(`${w.base}/studio/evaluations`, { dataset: 'qa-small', scope: { projectId: w.project.id }, options: { topK: 6 }, judge: true });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'QUEUED', dataset: 'qa-small', modelConfigId: 'mock-grounded', judge: true, isDemo: true, progress: { done: 0, total: 12 } });

    await app.get(StudioService).runEvaluation(created.body.id);
    const done = await w.c.get(`${w.base}/studio/evaluations/${created.body.id}`);
    expect(done.body.status).toBe('SUCCEEDED');
    expect(done.body.metrics).toMatchObject({
      items: 12,
      completed: 12,
      failed: 0,
      faithfulness: 1,
      retrievalRecall: 1,
      answerAccuracy: 1,
      abstentionAccuracy: 1,
      answerRelevance: 4,
    });
    expect(Number(done.body.metrics.costPerAnswer)).toBeGreaterThan(0);
    expect(done.body.items).toHaveLength(12);
    expect(done.body.items.find((i: any) => !i.answerable)).toMatchObject({ abstained: true, abstainCorrect: true, retrievalHit: null, relevance: null });
    expect(done.body.runIds).toHaveLength(12);

    const evalUnits = units.filter((u) => u.options?.evaluationId === created.body.id);
    expect(evalUnits.filter((u) => u.graph === 'grounded_qa')).toHaveLength(12);
    expect(evalUnits.filter((u) => u.graph === 'answer_judge')).toHaveLength(10);
    expect(evalUnits.filter((u) => u.graph === 'grounded_qa').every((u) => u.options.topK === 6)).toBe(true);
    expect(await prisma.thread.count({ where: { workspaceId: w.workspaceId } })).toBe(0);
    expect(await prisma.aiRun.count({ where: { workspaceId: w.workspaceId, lab: false } })).toBe(0);

    const list = await w.c.get(`${w.base}/studio/evaluations`);
    expect(list.body[0]).toMatchObject({ id: created.body.id, status: 'SUCCEEDED' });
    expect(list.body[0]).not.toHaveProperty('items');
    const stranger = await workspace('studio-eval-x');
    expect((await stranger.c.get(`${stranger.base}/studio/evaluations/${created.body.id}`)).status).toBe(404);
  });
});
