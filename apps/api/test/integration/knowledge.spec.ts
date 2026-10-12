import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resetEnvCache } from '../../src/config/env';
import { newId } from '../../src/common/ids';
import { PrismaService } from '../../src/infra/prisma.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { RunExecutorService } from '../../src/modules/runs/run-executor.service';
import { createApp, registered } from './harness';

/**
 * Gate 4: insight artifacts (pins, staleness), version diff, notes, workspace search and thread
 * scope changes, against a fake AI service for run units and semantic search.
 */
let app: INestApplication;
let prisma: PrismaService;
let ai: Server;
const units: any[] = [];

function line(res: any, type: string, data: Record<string, unknown>) {
  res.write(JSON.stringify({ schemaVersion: 1, type, ts: new Date().toISOString(), data }) + '\n');
}

function scopeOf(token: string) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

beforeAll(async () => {
  ai = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === '/internal/search') {
        const svids: string[] = scopeOf(body.scopeToken).svids;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ items: svids.slice(0, 1).map((svid) => ({ chunkId: newId(), sourceVersionId: svid, page: 1, snippet: 'Growth is 14.2% in the base case.', score: 0.8 })), latencyMs: 3 }));
        return;
      }
      if (req.url !== '/internal/runs/units') {
        res.writeHead(404).end();
        return;
      }
      units.push(body);
      const svids: string[] = scopeOf(body.scopeToken).svids;
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      line(res, 'node.started', { node: 'gather', step: 1 });
      line(res, 'node.finished', { node: 'gather', step: 1, status: 'SUCCEEDED', durationMs: 2 });
      const action = body.input.params?.action ?? body.input.action;
      const json = action === 'flashcards';
      line(res, 'run.finished', {
        status: 'SUCCEEDED',
        outcome: 'ANSWERED',
        answer: json ? 'Flashcards generated (1 items).' : 'The base case projects 14.2% growth [S1].',
        artifact: {
          kind: action,
          title: 'ignored',
          format: json ? 'json' : 'markdown',
          content: json ? { items: [{ front: 'Base-case growth …?', back: '14.2% [S1]', marker: 'S1' }] } : { markdown: 'The base case projects 14.2% growth [S1].' },
          fallback: false,
          sourceVersionIds: svids,
        },
      });
      res.end();
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

type U = Awaited<ReturnType<typeof registered>> & { projectId: string };

async function upload(u: U, filename: string, text: string, sourceId?: string) {
  const bytes = Buffer.from(text);
  const up = await u.c.post(`/api/workspaces/${u.workspaceId}/uploads`, { projectId: u.projectId, filename, sizeBytes: bytes.length, ...(sourceId ? { sourceId } : {}) });
  await u.c.send('put', up.body.url, bytes, { 'content-type': up.body.headers['Content-Type'] });
  const done = await u.c.post(`/api/workspaces/${u.workspaceId}/uploads/${up.body.uploadId}/complete`, {});
  await prisma.sourceVersion.update({ where: { id: done.body.versionId }, data: { ingestionState: 'READY' } });
  await prisma.source.update({ where: { id: done.body.sourceId }, data: { ingestionState: 'READY' } });
  await prisma.sourcePage.create({ data: { id: newId(), workspaceId: u.workspaceId, sourceVersionId: done.body.versionId, pageNo: 1, text } });
  return { sourceId: done.body.sourceId as string, versionId: done.body.versionId as string };
}

async function user(label: string): Promise<U> {
  const u = await registered(app, label);
  return { ...u, projectId: u.projects.find((p) => p.kind === 'KNOWLEDGE').id };
}

async function runAction(u: U, graph: string, action: string | undefined, scope: Record<string, unknown>) {
  const res = await u.c.post(`/api/workspaces/${u.workspaceId}/runs`, { graph, input: action ? { action } : {}, scope });
  if (res.status === 201 && res.body.runId) await app.get(RunExecutorService).execute(res.body.runId);
  return res;
}

describe('knowledge (gate 4)', () => {
  it('saves an insight run as an artifact pinned to its version, with the action tier', async () => {
    const u = await user('insight');
    const doc = await upload(u, 'outlook.md', '# Outlook\n\nGrowth is 14.2% in the base case.');
    const res = await runAction(u, 'insight', 'flashcards', { sourceIds: [doc.sourceId] });
    expect(res.status).toBe(201);
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: res.body.runId } });
    expect(run.tier).toBe('T1');
    expect((run.input as any).params.action).toBe('flashcards');

    const list = await u.c.get(`/api/workspaces/${u.workspaceId}/artifacts?sourceId=${doc.sourceId}`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([expect.objectContaining({ kind: 'FLASHCARDS', action: 'flashcards', title: 'Generate Flashcards · outlook', stale: false, sourceId: doc.sourceId, projectId: u.projectId, runId: run.id })]);
    const one = await u.c.get(`/api/workspaces/${u.workspaceId}/artifacts/${list.body[0].id}`);
    expect(one.body.content.items[0].back).toContain('[S1]');
    expect(one.body.pins).toEqual([expect.objectContaining({ sourceVersionId: doc.versionId, versionNo: 1, current: true })]);

    const events = await prisma.aiRunEvent.findMany({ where: { runId: run.id, type: 'run.finished' } });
    expect((events[0].data as any).artifactId).toBe(list.body[0].id);

    // Re-running the executor for the same run never duplicates the artifact.
    expect(await prisma.artifact.count({ where: { runId: run.id } })).toBe(1);
  });

  it('rejects unknown actions and comparisons over a single document', async () => {
    const u = await user('reject');
    const doc = await upload(u, 'one.md', 'Only one document.');
    expect((await runAction(u, 'insight', 'compare', { sourceIds: [doc.sourceId] })).body.code).toBe('UNKNOWN_ACTION');
    expect((await runAction(u, 'insight', 'nonsense', { sourceIds: [doc.sourceId] })).status).toBe(400);
    const cmp = await runAction(u, 'multi_doc_compare', undefined, { sourceIds: [doc.sourceId] });
    expect(cmp.status).toBe(400);
    expect(cmp.body.code).toBe('NEEDS_MORE_SOURCES');
    const risk = await runAction(u, 'risk_contradiction', 'contradictions', { sourceIds: [doc.sourceId] });
    expect(risk.status).toBe(201);
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: risk.body.runId } })).tier).toBe('T1');
  });

  it('marks artifacts stale when a new version is uploaded and summarises the diff', async () => {
    const u = await user('stale');
    const doc = await upload(u, 'report.md', 'Intro\n\nGrowth is 14.2% in the base case.\n\nPricing pressure from suites.');
    await runAction(u, 'insight', 'quick_summary', { sourceIds: [doc.sourceId] });
    const v2 = await upload(u, 'report.md', 'Intro\n\nGrowth is 12.5% in the base case.\n\nA new appendix lists questions.', doc.sourceId);

    const [a] = (await u.c.get(`/api/workspaces/${u.workspaceId}/artifacts?sourceId=${doc.sourceId}`)).body;
    expect(a.stale).toBe(true);
    const detail = await u.c.get(`/api/workspaces/${u.workspaceId}/artifacts/${a.id}`);
    expect(detail.body.pins[0]).toMatchObject({ versionNo: 1, current: false, currentVersionId: v2.versionId });

    const diff = await u.c.get(`/api/workspaces/${u.workspaceId}/sources/${doc.sourceId}/versions/${v2.versionId}/diff`);
    expect(diff.status).toBe(200);
    expect(diff.body).toMatchObject({ from: { versionNo: 1 }, to: { versionNo: 2 }, summary: { unchanged: 1, changed: 1, added: 1, removed: 1 } });
  });

  it('stores anchored notes and finds sources, threads, artifacts, notes and passages in search', async () => {
    const u = await user('search');
    const doc = await upload(u, 'atlas-brief.md', 'Growth is 14.2% in the base case.');
    await runAction(u, 'insight', 'key_facts', { sourceIds: [doc.sourceId] });
    const note = await u.c.post(`/api/workspaces/${u.workspaceId}/notes`, {
      body: 'Check the atlas growth assumption',
      sourceId: doc.sourceId,
      sourceVersionId: doc.versionId,
      quote: 'Growth is 14.2%',
      anchor: { sourceVersionId: doc.versionId, selectors: { page: 1, textPosition: { start: 0, end: 15 } } },
    });
    expect(note.status).toBe(201);
    expect(note.body.projectId).toBe(u.projectId);
    const notes = await u.c.get(`/api/workspaces/${u.workspaceId}/notes?sourceId=${doc.sourceId}`);
    expect(notes.body).toHaveLength(1);

    const s = await u.c.get(`/api/workspaces/${u.workspaceId}/search?q=atlas`);
    expect(s.status).toBe(200);
    const types = new Set(s.body.items.map((i: any) => i.type));
    expect(types).toEqual(new Set(['source', 'artifact', 'note', 'passage']));
    expect(s.body.semantic.status).toBe('OK');
    const passage = s.body.items.find((i: any) => i.type === 'passage');
    expect(passage).toMatchObject({ sourceId: doc.sourceId, sourceVersionId: doc.versionId, title: 'atlas-brief.md' });

    const prefix = await u.c.get(`/api/workspaces/${u.workspaceId}/search?q=atl&semantic=false`);
    expect(prefix.body.items.some((i: any) => i.type === 'source')).toBe(true);
    expect(prefix.body.semantic.status).toBe('SKIPPED');

    const other = await user('search-other');
    const leak = await other.c.get(`/api/workspaces/${other.workspaceId}/search?q=atlas`);
    expect(leak.body.items).toEqual([]);
    expect((await other.c.get(`/api/workspaces/${u.workspaceId}/search?q=atlas`)).status).toBe(404);
    expect((await other.c.post(`/api/workspaces/${other.workspaceId}/notes`, { body: 'x', sourceId: doc.sourceId })).status).toBe(404);
  });

  it('changes a thread scope so later questions use the attached documents', async () => {
    const u = await user('scope');
    const a = await upload(u, 'a.md', 'Alpha document.');
    const b = await upload(u, 'b.md', 'Beta document.');
    const first = await u.c.post(`/api/workspaces/${u.workspaceId}/runs`, { graph: 'grounded_qa', input: { question: 'What is alpha?' }, scope: { sourceVersionIds: [a.versionId] } });
    expect(first.status).toBe(201);
    const threadId = first.body.threadId;

    const put = await u.c.send('put', `/api/workspaces/${u.workspaceId}/threads/${threadId}/scope`, { sourceVersionIds: [a.versionId, b.versionId] });
    expect(put.status).toBe(200);
    expect(put.body.sources.map((s: any) => s.title).sort()).toEqual(['a.md', 'b.md']);

    const next = await u.c.post(`/api/workspaces/${u.workspaceId}/runs`, { graph: 'grounded_qa', threadId, input: { question: 'And beta?' } });
    expect(next.status).toBe(201);
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: next.body.runId } });
    expect(((run.scope as any).sourceVersionIds as string[]).sort()).toEqual([a.versionId, b.versionId].sort());
    const thread = await u.c.get(`/api/workspaces/${u.workspaceId}/threads/${threadId}`);
    expect(thread.body.scope.sources).toHaveLength(2);

    const other = await user('scope-other');
    const foreign = await upload(other, 'x.md', 'Foreign.');
    const bad = await u.c.send('put', `/api/workspaces/${u.workspaceId}/threads/${threadId}/scope`, { sourceVersionIds: [foreign.versionId] });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_SCOPE');
  });
});
