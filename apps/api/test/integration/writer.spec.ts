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
 * Gate 5: manuscripts, scene saves with optimistic concurrency, revisions, AI suggestions, Narrative DNA,
 * continuity issues, research notes and export, against a fake AI service for writer graphs.
 */
let app: INestApplication;
let prisma: PrismaService;
let ai: Server;
const units: any[] = [];

function line(res: any, type: string, data: Record<string, unknown>) {
  res.write(JSON.stringify({ schemaVersion: 1, type, ts: new Date().toISOString(), data }) + '\n');
}

function artifactFor(graph: string, params: any) {
  if (graph === 'writer_revision') {
    return { kind: 'revision', mode: params.mode, variants: [{ text: `${params.text} (revised)`, rationale: 'Sharper.' }, { text: 'Short.', rationale: 'Shorter.' }], fallback: false };
  }
  if (graph === 'continuity_check') {
    const quote = (params.text as string).split(/(?<=\.)\s+/).find((s) => /blue eyes/.test(s));
    return { kind: 'continuity', issues: quote ? [{ entity: 'Mara', fact: 'eye color', expected: 'green', found: 'blue', quote, severity: 'HIGH' }] : [] };
  }
  return {
    kind: 'dna',
    entities: [
      { kind: 'CHARACTER', name: 'Mara', mentions: 3, facts: { 'eye color': 'green' }, evidence: 'Mara had green eyes.' },
      { kind: 'PLACE', name: 'Veldt Harbor', mentions: 2, facts: {}, evidence: 'They met at Veldt Harbor.' },
    ],
    relations: [{ a: 'Mara', b: 'Tomas', kind: 'APPEARS_WITH', weight: 2 }],
    proposalsOnly: true,
  };
}

beforeAll(async () => {
  ai = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.url !== '/internal/runs/units') {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw);
      units.push(body);
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      line(res, 'node.started', { node: 'step', step: 1 });
      line(res, 'node.finished', { node: 'step', step: 1, status: 'SUCCEEDED', durationMs: 1 });
      line(res, 'run.finished', { status: 'SUCCEEDED', outcome: 'ANSWERED', answer: 'done', artifact: artifactFor(body.graph, body.input.params) });
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

const doc = (paras: [string, string][]) => ({
  type: 'doc',
  content: paras.map(([blockId, text]) => ({ type: 'paragraph', attrs: { blockId }, ...(text ? { content: [{ type: 'text', text }] } : {}) })),
});
const run = (id: string) => app.get(RunExecutorService).execute(id);

async function setup(label: string) {
  const u = await registered(app, label);
  const base = `/api/workspaces/${u.workspaceId}`;
  const m = await u.c.post(`${base}/manuscripts`, { title: 'The Glass Meridian' });
  expect(m.status).toBe(201);
  const scene = m.body.nodes.find((n: any) => n.kind === 'SCENE');
  const ms = `${base}/manuscripts/${m.body.id}`;
  return { u, base, ms, m: m.body, scene, docUrl: `${ms}/nodes/${scene.id}/doc` };
}

describe('writer (gate 5)', () => {
  it('creates a manuscript with an outline in a new writing project', async () => {
    const { u, m, ms, base } = await setup('outline');
    const project = await prisma.project.findUniqueOrThrow({ where: { id: m.projectId } });
    expect(project).toMatchObject({ kind: 'WRITER', name: 'The Glass Meridian', workspaceId: u.workspaceId });
    expect(m.nodes.map((n: any) => [n.kind, n.title])).toEqual([
      ['PART', 'Part One'],
      ['CHAPTER', 'Chapter 1'],
      ['SCENE', 'Scene 1'],
    ]);
    const chapter = m.nodes.find((n: any) => n.kind === 'CHAPTER');
    const s2 = await u.c.post(`${ms}/nodes`, { kind: 'SCENE', title: 'Scene 2', parentId: chapter.id });
    expect(s2.body.position).toBe(1);
    const first = await u.c.post(`${ms}/nodes`, { kind: 'SCENE', title: 'Prologue', parentId: chapter.id, position: 0 });
    const order = (await u.c.get(ms)).body.nodes.filter((n: any) => n.parentId === chapter.id).sort((a: any, b: any) => a.position - b.position);
    expect(order.map((n: any) => n.title)).toEqual(['Prologue', 'Scene 1', 'Scene 2']);
    expect((await u.c.post(`${ms}/nodes`, { kind: 'SCENE', title: 'Loose', parentId: m.nodes[0].id })).body.code).toBe('INVALID_PARENT');
    expect((await u.c.send('delete', `${ms}/nodes/${first.body.id}`)).status).toBe(204);
    expect((await u.c.get(`${base}/manuscripts`)).body).toEqual([expect.objectContaining({ id: m.id, scenes: 2 })]);
  });

  it('saves scenes with optimistic concurrency, coalesced revisions, word counts and restore', async () => {
    const { u, ms, docUrl } = await setup('save');
    const empty = await u.c.get(docUrl);
    expect(empty.body.revision).toBe(0);
    const r1 = await u.c.patch(docUrl, { content: doc([['b1', 'Mara crossed the bridge at dawn.']]), revision: 0 });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ revision: 1, wordCount: 6, stats: { words: 6, todayWords: 6 } });

    const stale = await u.c.patch(docUrl, { content: doc([['b1', 'Elsewhere.']]), revision: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'REVISION_CONFLICT', current: { revision: 1, text: 'Mara crossed the bridge at dawn.' } });

    await u.c.patch(docUrl, { content: doc([['b1', 'Mara crossed the bridge at dawn.'], ['b2', 'The river was silver.']]), revision: 1 });
    const revs = await u.c.get(`${docUrl}/revisions`);
    expect(revs.body.map((r: any) => [r.revision, r.origin])).toEqual([[2, 'AUTHOR']]);

    const restored = await u.c.post(`${docUrl}/revisions/2/restore`, { revision: 2 });
    expect(restored.body).toMatchObject({ revision: 3, origin: 'RESTORE' });
    expect((await u.c.get(`${docUrl}/revisions/3`)).body).toMatchObject({ origin: 'RESTORE', note: 'Restored r2' });
    expect((await u.c.get(`${docUrl}/revisions`)).body.map((r: any) => [r.revision, r.origin])).toEqual([
      [3, 'RESTORE'],
      [2, 'AUTHOR'],
    ]);
    expect((await u.c.get(ms)).body.stats.words).toBe(10);
    expect((await u.c.patch(docUrl, { content: { type: 'paragraph' }, revision: 3 })).body.code).toBe('INVALID_DOCUMENT');
  });

  it('turns writer_revision runs into suggestions with accept, undo, supersede, stale and reject', async () => {
    const { u, ms, docUrl, scene, base } = await setup('suggest');
    await u.c.patch(docUrl, { content: doc([['p1', 'It was very dark.'], ['p2', 'She waited.']]), revision: 0 });
    const req = await u.c.post(`${ms}/nodes/${scene.id}/suggestions`, { mode: 'rewrite', blockIds: ['p1'] });
    expect(req.status).toBe(201);
    await run(req.body.suggestions[0].runId);
    expect(units.at(-1).input.params).toMatchObject({ text: 'It was very dark.', mode: 'rewrite', blockId: 'p1', suggestionId: req.body.suggestions[0].id });
    let list = (await u.c.get(`${ms}/suggestions?nodeId=${scene.id}`)).body;
    expect(list[0]).toMatchObject({ state: 'PENDING', blockId: 'p1', baseText: 'It was very dark.', run: { status: 'SUCCEEDED' } });
    expect(list[0].variants[0].text).toBe('It was very dark. (revised)');

    const accepted = await u.c.patch(docUrl, { content: doc([['p1', 'It was very dark. (revised)'], ['p2', 'She waited.']]), revision: 1, action: 'accept', suggestionId: list[0].id, variant: 0 });
    expect(accepted.body).toMatchObject({ revision: 2, origin: 'POST_AI' });
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: list[0].id } })).state).toBe('ACCEPTED');
    const undone = await u.c.patch(docUrl, { content: doc([['p1', 'It was very dark.'], ['p2', 'She waited.']]), revision: 2, action: 'undo', suggestionId: list[0].id });
    expect(undone.body.origin).toBe('UNDO');
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: list[0].id } })).state).toBe('PENDING');

    const batch = await u.c.post(`${ms}/nodes/${scene.id}/suggestions`, { mode: 'shorten', all: true });
    expect(batch.body.suggestions).toHaveLength(2);
    expect(batch.body.batchId).toBeTruthy();
    for (const s of batch.body.suggestions) await run(s.runId);
    list = (await u.c.get(`${ms}/suggestions?nodeId=${scene.id}`)).body;
    expect(list.find((s: any) => s.id === req.body.suggestions[0].id).state).toBe('SUPERSEDED');
    const runRow = await prisma.aiRun.findUniqueOrThrow({ where: { id: batch.body.suggestions[0].runId } });
    expect(runRow.tier).toBe('T0');

    await u.c.patch(docUrl, { content: doc([['p1', 'It was very dark.'], ['p2', 'She waited for hours.']]), revision: 3 });
    const states = (await u.c.get(`${ms}/suggestions?nodeId=${scene.id}&state=STALE`)).body;
    expect(states.map((s: any) => s.blockId)).toEqual(['p2']);
    const stale = states[0];
    const late = await u.c.patch(docUrl, { content: doc([['p1', 'It was very dark.'], ['p2', 'Short.']]), revision: 4, action: 'accept', suggestionId: stale.id, variant: 1 });
    expect(late.body.code).toBe('SUGGESTION_NOT_PENDING');

    const p1 = list.find((s: any) => s.blockId === 'p1' && s.state === 'PENDING');
    expect((await u.c.patch(`${base}/suggestions/${p1.id}`, { state: 'REJECTED' })).body.state).toBe('REJECTED');
    expect((await u.c.patch(`${base}/suggestions/${p1.id}`, { state: 'PENDING' })).body.state).toBe('PENDING');
    expect((await u.c.patch(`${base}/suggestions/${stale.id}`, { state: 'PENDING' })).body.code).toBe('INVALID_TRANSITION');
  });

  it('proposes Narrative DNA from the manuscript; only the author makes canon', async () => {
    const { u, ms, docUrl } = await setup('dna');
    await u.c.patch(docUrl, { content: doc([['a', 'Mara had green eyes. They met at Veldt Harbor.'], ['b', 'Tomas waited for Mara.']]), revision: 0 });
    const ex = await u.c.post(`${ms}/dna/extract`, {});
    expect(ex.status).toBe(201);
    await run(ex.body.runId);
    const dna = (await u.c.get(`${ms}/dna`)).body;
    expect(dna.facts.every((f: any) => f.status === 'PROPOSED' && f.origin === 'AI_EXTRACTED')).toBe(true);
    const eye = dna.facts.find((f: any) => f.predicate === 'eye color');
    expect(eye).toMatchObject({ subject: 'Mara', value: 'green', evidence: [{ blockId: 'a', quote: 'Mara had green eyes.', state: 'EXACT' }] });
    expect(dna.links).toEqual([expect.objectContaining({ source: 'Mara', target: 'Tomas', status: 'PROPOSED' })]);

    const approved = await u.c.patch(`${ms}/dna/facts/${eye.id}`, { status: 'CANON' });
    expect(approved.body.status).toBe('CANON');
    const place = dna.facts.find((f: any) => f.subject === 'Veldt Harbor');
    expect((await u.c.patch(`${ms}/dna/facts/${place.id}`, { status: 'RETIRED' })).body).toMatchObject({ status: 'RETIRED', note: 'Rejected by author' });
    expect((await u.c.get(`${ms}/dna`)).body.version).toBe(2);

    // A second extraction does not duplicate known facts.
    const again = await u.c.post(`${ms}/dna/extract`, {});
    await run(again.body.runId);
    expect((await u.c.get(`${ms}/dna`)).body.facts).toHaveLength(dna.facts.length);

    // Evidence follows edits: moved to another paragraph → SHIFTED; removed → ORPHANED.
    await u.c.patch(docUrl, { content: doc([['b', 'Tomas waited for Mara. Mara had green eyes.']]), revision: 1 });
    expect((await u.c.get(`${ms}/dna`)).body.facts.find((f: any) => f.id === eye.id).evidence[0]).toMatchObject({ state: 'SHIFTED', blockId: 'b' });
    await u.c.patch(docUrl, { content: doc([['b', 'Tomas waited.']]), revision: 2 });
    expect((await u.c.get(`${ms}/dna`)).body.facts.find((f: any) => f.id === eye.id).evidence[0].state).toBe('ORPHANED');

    const author = await u.c.post(`${ms}/dna/facts`, { subject: 'Tomas', predicate: 'years away', value: 'eleven' });
    expect(author.body).toMatchObject({ status: 'CANON', origin: 'AUTHOR', statement: 'Tomas: years away is eleven.' });
  });

  it('records continuity issues with paired anchors; dismissed issues stay dismissed, fixed ones resolve', async () => {
    const { u, ms, docUrl, scene } = await setup('continuity');
    expect((await u.c.post(`${ms}/continuity/check`, {})).body.code).toBe('NO_CANON');
    await u.c.patch(docUrl, { content: doc([['c1', 'Mara had green eyes.'], ['c2', 'Mara looked up, her blue eyes narrowing.']]), revision: 0 });
    const fact = (await u.c.post(`${ms}/dna/facts`, { subject: 'Mara', predicate: 'eye color', value: 'green' })).body;
    const check = await u.c.post(`${ms}/continuity/check`, {});
    expect(check.body.runs).toHaveLength(1);
    await run(check.body.runs[0].runId);
    expect(units.at(-1).input.params.canon).toEqual([{ id: fact.id, name: 'Mara', facts: { 'eye color': 'green' } }]);
    let issues = (await u.c.get(`${ms}/continuity?state=OPEN`)).body;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ nodeId: scene.id, blockId: 'c2', factId: fact.id, expected: 'green', found: 'blue', severity: 'HIGH', sceneTitle: 'Scene 1' });
    expect(issues[0].anchors[0]).toMatchObject({ role: 'scene', blockId: 'c2', state: 'EXACT' });
    expect(issues[0].anchors[1]).toMatchObject({ role: 'canon', factId: fact.id });

    await u.c.patch(`${ms}/continuity/${issues[0].id}`, { state: 'DISMISSED' });
    const again = await u.c.post(`${ms}/continuity/check`, {});
    await run(again.body.runs[0].runId);
    expect((await u.c.get(`${ms}/continuity?state=OPEN`)).body).toHaveLength(0);
    await u.c.patch(`${ms}/continuity/${issues[0].id}`, { state: 'OPEN' });

    await u.c.patch(docUrl, { content: doc([['c1', 'Mara had green eyes.'], ['c2', 'Mara looked up, her green eyes narrowing.']]), revision: 1 });
    const fixed = await u.c.post(`${ms}/continuity/check`, {});
    await run(fixed.body.runs[0].runId);
    issues = (await u.c.get(`${ms}/continuity`)).body;
    expect(issues.map((i: any) => i.state)).toEqual(['RESOLVED']);
  });

  it('keeps research notes from knowledge excerpts and exports Markdown and DOCX with footnotes', async () => {
    const { u, ms, docUrl, base } = await setup('research');
    const knowledge = u.projects.find((p: any) => p.kind === 'KNOWLEDGE');
    const sourceId = newId();
    const versionId = newId();
    await prisma.source.create({ data: { id: sourceId, workspaceId: u.workspaceId, projectId: knowledge.id, title: 'Lantern Ledger.pdf', mimeType: 'application/pdf', currentVersionId: versionId, createdById: u.userId } });
    await prisma.sourceVersion.create({ data: { id: versionId, workspaceId: u.workspaceId, sourceId, versionNo: 1, mimeType: 'application/pdf', sha256: 'x', sizeBytes: 1, storedObjectId: newId(), createdById: u.userId } });
    const ex = await u.c.post(`${base}/excerpts`, { sourceId, quote: 'The lamp burned whale oil until 1887.', anchor: { sourceVersionId: versionId, selectors: { page: 4 } } });
    expect(ex.status).toBe(201);
    const note = await u.c.post(`${ms}/research-notes`, { excerptId: ex.body.id, body: 'Use for chapter 3.' });
    expect(note.body).toMatchObject({ title: 'Lantern Ledger.pdf', quote: 'The lamp burned whale oil until 1887.', source: { sourceId, sourceVersionId: versionId } });
    await u.c.send('delete', `${base}/excerpts/${ex.body.id}`);
    expect((await u.c.get(`${ms}/research-notes`)).body[0].quote).toBe('The lamp burned whale oil until 1887.');

    await u.c.patch(docUrl, {
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { blockId: 'x1' }, content: [{ type: 'text', text: 'The lamp still smelled of oil.' }] },
          { type: 'citation', attrs: { blockId: 'x2', noteId: note.body.id }, content: [{ type: 'text', text: '“The lamp burned whale oil until 1887.” — Lantern Ledger.pdf, p. 4' }] },
        ],
      },
      revision: 0,
    });
    expect((await u.c.get(ms)).body.stats.words).toBe(6);
    const md = await u.c.get(`${ms}/export?format=md`);
    expect(md.headers['content-type']).toMatch(/text\/markdown/);
    expect(md.text).toContain('# The Glass Meridian');
    expect(md.text).toContain('## Part One');
    expect(md.text).toContain('The lamp still smelled of oil.[^1]');
    expect(md.text).toContain('[^1]: “The lamp burned whale oil until 1887.” — Lantern Ledger.pdf, p. 4');
    const docx = await u.c.get(`${ms}/export?format=docx`);
    expect(docx.status).toBe(200);
    expect(docx.headers['content-disposition']).toContain('the-glass-meridian.docx');
    const compiled = await u.c.get(`${ms}/compiled`);
    expect(compiled.body.footnotes).toHaveLength(1);
    expect((await u.c.get(`${ms}/export?format=pdf`)).status).toBe(400);
  });

  it('hides manuscripts from other workspaces', async () => {
    const { ms, docUrl } = await setup('owner5');
    const other = await registered(app, 'intruder5');
    const swap = (url: string) => url.replace(/workspaces\/[^/]+/, `workspaces/${other.workspaceId}`);
    expect((await other.c.get(swap(ms))).status).toBe(404);
    expect((await other.c.get(swap(docUrl))).status).toBe(404);
    expect((await other.c.patch(swap(docUrl), { content: doc([['z', 'x']]), revision: 0 })).status).toBe(404);
  });
});
