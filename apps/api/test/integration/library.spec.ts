import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resetEnvCache } from '../../src/config/env';
import { newId } from '../../src/common/ids';
import { PrismaService } from '../../src/infra/prisma.service';
import { LibraryService } from '../../src/modules/library/library.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { RunExecutorService } from '../../src/modules/runs/run-executor.service';
import { createApp, registered } from './harness';

/**
 * Gate 6: shelves, reading progress, private annotations with tombstone sync, bookmarks, collections, stats,
 * spoiler-bounded passage explanations and reader excerpts, against a fake AI service.
 */
let app: INestApplication;
let prisma: PrismaService;
let ai: Server;
const units: any[] = [];

const CHAPTERS = [
  { page: 1, href: 'chapter-1.xhtml', title: 'Chapter 1 — The Halcyon Ring', idref: 'ch1' },
  { page: 2, href: 'chapter-2.xhtml', title: 'Chapter 2 — The Archivist', idref: 'ch2' },
  { page: 3, href: 'chapter-3.xhtml', title: 'Chapter 3 — A Lantern Fails', idref: 'ch3' },
];

function line(res: any, type: string, data: Record<string, unknown>) {
  res.write(JSON.stringify({ schemaVersion: 1, type, ts: new Date().toISOString(), data }) + '\n');
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
      line(res, 'citation.validated', { marker: 'S1', state: 'VALID', score: 1, quote: 'the ring', anchor: { sourceVersionId: body.scope?.sourceVersionIds?.[0], page: 1 } });
      line(res, 'run.finished', { status: 'SUCCEEDED', outcome: 'ANSWERED', answer: 'It refers to the ring [S1].' });
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

/** A READY EPUB source in the user's Library project, as ingestion leaves it (chapters in the job stats). */
async function epubSource(u: Awaited<ReturnType<typeof registered>>, title = 'small-lanterns.epub') {
  const projectId = u.projects.find((p) => p.kind === 'LIBRARY').id;
  const sourceId = newId();
  const versionId = newId();
  await prisma.source.create({
    data: { id: sourceId, workspaceId: u.workspaceId, projectId, title, kind: 'BOOK', mimeType: 'application/epub+zip', ingestionState: 'READY', createdById: u.userId, currentVersionId: versionId },
  });
  await prisma.sourceVersion.create({
    data: { id: versionId, workspaceId: u.workspaceId, sourceId, versionNo: 1, storedObjectId: newId(), mimeType: 'application/epub+zip', sha256: 'x', sizeBytes: 1, pageCount: 3, ingestionState: 'READY', createdById: u.userId },
  });
  await prisma.ingestionJob.create({
    data: { id: newId(), workspaceId: u.workspaceId, sourceVersionId: versionId, state: 'READY', stats: { pages: 3, chapters: CHAPTERS, metadata: { title: 'Orbit of Small Lanterns', authors: ['Anaïs Verhoeven'] } } },
  });
  return { sourceId, versionId };
}

describe('library (gate 6)', () => {
  it('adds a manual book, moves it through the shelves and keeps dates consistent', async () => {
    const u = await registered(app, 'shelf');
    const lib = `/api/workspaces/${u.workspaceId}/library`;
    const res = await u.c.post(`${lib}/items`, { book: { title: 'Salt Year', authors: ['Hedda Lund'], isbn13: '9780000000019' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'TO_READ', startedAt: null, book: { title: 'Salt Year', metadataSource: 'MANUAL' }, chapters: [] });
    expect(res.body.book.coverTone).toBeGreaterThanOrEqual(1);
    const id = res.body.id;

    expect((await u.c.post(`${lib}/items`, { book: { title: 'X', isbn13: '12345' } })).status).toBe(400);
    expect((await u.c.post(`${lib}/items`, {})).status).toBe(400);

    const reading = await u.c.patch(`${lib}/items/${id}`, { status: 'READING', rating: 4 });
    expect(reading.body).toMatchObject({ status: 'READING', rating: 4 });
    expect(reading.body.startedAt).toBeTruthy();
    const done = await u.c.patch(`${lib}/items/${id}`, { status: 'FINISHED', book: { subtitle: 'A novel' } });
    expect(done.body.finishedAt).toBeTruthy();
    expect(done.body.startedAt).toBe(reading.body.startedAt);
    expect(done.body.book.subtitle).toBe('A novel');
    const back = await u.c.patch(`${lib}/items/${id}`, { status: 'TO_READ', rating: 0 });
    expect(back.body).toMatchObject({ startedAt: null, finishedAt: null, rating: null });

    expect((await u.c.get(`${lib}/items?status=TO_READ`)).body.map((i: any) => i.id)).toEqual([id]);
    expect((await u.c.get(`${lib}/items?status=READING`)).body).toEqual([]);
    expect((await u.c.get(`${lib}/items?q=salt`)).body).toHaveLength(1);
  });

  it('keeps one item per uploaded file and fills blank book fields from EPUB metadata only', async () => {
    const u = await registered(app, 'epub');
    const lib = `/api/workspaces/${u.workspaceId}/library`;
    const { sourceId } = await epubSource(u);
    const a = await u.c.post(`${lib}/items`, { sourceId });
    expect(a.status).toBe(201);
    // The file is already ingested, so its recorded package metadata fills the new book at once.
    expect(a.body.book).toMatchObject({ title: 'Orbit of Small Lanterns', authors: ['Anaïs Verhoeven'], metadataSource: 'EPUB' });
    expect(a.body.chapters.map((c: any) => c.page)).toEqual([1, 2, 3]);
    expect(a.body.source).toMatchObject({ id: sourceId, mimeType: 'application/epub+zip' });
    const again = await u.c.post(`${lib}/items`, { sourceId });
    expect(again.body.id).toBe(a.body.id);

    const svc = app.get(LibraryService);
    expect(await svc.applyIngestedMetadata(sourceId, { title: 'Orbit of Small Lanterns', authors: ['Anaïs Verhoeven'], isbn: '9780000000002', subjects: ['Science fiction'] })).toBe(1);
    const enriched = (await u.c.get(`${lib}/items/${a.body.id}`)).body.book;
    expect(enriched).toMatchObject({ title: 'Orbit of Small Lanterns', authors: ['Anaïs Verhoeven'], isbn13: '9780000000002', subjects: ['Science fiction'], metadataSource: 'EPUB' });

    await u.c.patch(`${lib}/items/${a.body.id}`, { book: { title: 'My title', publisher: 'Mine' } });
    await svc.applyIngestedMetadata(sourceId, { title: 'Other', publisher: 'Theirs', language: 'en' });
    const kept = (await u.c.get(`${lib}/items/${a.body.id}`)).body.book;
    expect(kept).toMatchObject({ title: 'My title', publisher: 'Mine', language: 'en' });

    const other = await u.c.post(`${lib}/items`, { sourceId: newId() });
    expect(other.status).toBe(404);
  });

  it('keeps items, progress and annotations private to their reader within a shared workspace', async () => {
    const owner = await registered(app, 'priv-owner');
    const peer = await registered(app, 'priv-peer');
    await prisma.workspaceMember.create({ data: { workspaceId: owner.workspaceId, userId: peer.userId, role: 'EDITOR' } });
    const lib = `/api/workspaces/${owner.workspaceId}/library`;
    const item = (await owner.c.post(`${lib}/items`, { book: { title: 'Private' } })).body;
    await owner.c.post(`${lib}/items/${item.id}/annotations`, { kind: 'HIGHLIGHT', locator: { href: 'x' }, quote: 'q' });

    expect((await peer.c.get(`${lib}/items`)).body).toEqual([]);
    for (const [m, url, body] of [
      ['get', `${lib}/items/${item.id}`],
      ['patch', `${lib}/items/${item.id}`, { rating: 1 }],
      ['get', `${lib}/items/${item.id}/annotations`],
      ['post', `${lib}/items/${item.id}/annotations`, { kind: 'HIGHLIGHT', locator: {} }],
      ['put', `${lib}/items/${item.id}/progress`, { locator: {}, percent: 0.5 }],
      ['delete', `${lib}/items/${item.id}`],
    ] as const) {
      expect({ m, url, status: (await peer.c.send(m, url, body)).status }).toMatchObject({ status: 404 });
    }
    const peerItem = (await peer.c.post(`${lib}/items`, { book: { title: 'Peer' } })).body;
    const col = (await owner.c.post(`${lib}/collections`, { name: 'Mine' })).body;
    expect((await owner.c.post(`${lib}/collections/${col.id}/items`, { itemId: peerItem.id })).status).toBe(404);
    expect((await owner.c.get(`/api/workspaces/${owner.workspaceId}/library/stats`)).body.highlights).toBe(1);
    expect((await peer.c.get(`/api/workspaces/${owner.workspaceId}/library/stats`)).body.highlights).toBe(0);
  });

  it('records progress, chapter and reading time, and starts a to-read book', async () => {
    const u = await registered(app, 'progress');
    const lib = `/api/workspaces/${u.workspaceId}/library`;
    const { sourceId } = await epubSource(u);
    const item = (await u.c.post(`${lib}/items`, { sourceId })).body;
    const loc = { href: 'chapter-2.xhtml#p3', type: 'application/xhtml+xml', locations: { cfi: 'epubcfi(/6/4[ch2]!/4/8)', progression: 0.4, totalProgression: 0.45 }, junk: 1 };
    const p = await u.c.send('put', `${lib}/items/${item.id}/progress`, { locator: loc, percent: 0.45, secondsDelta: 120 });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ percent: 0.45, chapterIndex: 1 });
    expect(p.body.locator.junk).toBeUndefined();
    await u.c.send('put', `${lib}/items/${item.id}/progress`, { locator: loc, percent: 0.46, secondsDelta: 60 });
    expect((await u.c.send('put', `${lib}/items/${item.id}/progress`, { locator: loc, percent: 2 })).status).toBe(400);

    const detail = (await u.c.get(`${lib}/items/${item.id}`)).body;
    expect(detail).toMatchObject({ status: 'READING', progress: { percent: 0.46 } });
    expect(detail.lastOpenedAt).toBeTruthy();
    const stats = (await u.c.get(`${lib}/stats`)).body;
    expect(stats).toMatchObject({ counts: { READING: 1 }, totalSeconds: 180, daysRead: 1, streak: 1 });
    expect(stats.activity).toHaveLength(14);
    expect(stats.activity.at(-1).seconds).toBe(180);
  });

  it('syncs annotations with client ids and tombstones', async () => {
    const u = await registered(app, 'annot');
    const lib = `/api/workspaces/${u.workspaceId}/library`;
    const item = (await u.c.post(`${lib}/items`, { book: { title: 'Notes' } })).body;
    const url = `${lib}/items/${item.id}/annotations`;
    const id = newId();
    const body = { id, kind: 'HIGHLIGHT', color: 'sage', locator: { href: 'chapter-1.xhtml', locations: { cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:10)' } }, quote: 'Halcyon Ring' };
    const a = await u.c.post(url, body);
    expect(a.status).toBe(201);
    expect((await u.c.post(url, body)).body.id).toBe(id);
    expect((await u.c.post(url, { kind: 'NOTE', locator: {} })).status).toBe(400);
    expect((await u.c.post(url, { kind: 'HIGHLIGHT', color: 'red', locator: {} })).status).toBe(400);

    const first = (await u.c.get(url)).body;
    expect(first.annotations).toHaveLength(1);
    const since = first.serverTime;
    await new Promise((r) => setTimeout(r, 5));
    expect((await u.c.patch(`${url}/${id}`, { note: 'Remember this', color: 'rose' })).body).toMatchObject({ note: 'Remember this', color: 'rose' });
    expect((await u.c.del(`${url}/${id}`)).status).toBe(204);
    expect((await u.c.get(url)).body.annotations).toEqual([]);
    const delta = (await u.c.get(`${url}?since=${encodeURIComponent(since)}`)).body.annotations;
    expect(delta).toHaveLength(1);
    expect(delta[0].deletedAt).toBeTruthy();
    expect((await u.c.patch(`${url}/${id}`, { note: 'x' })).status).toBe(404);
    expect((await u.c.get(`${url}?since=yesterday`)).status).toBe(400);

    const bm = await u.c.post(`${lib}/items/${item.id}/bookmarks`, { locator: { href: 'chapter-2.xhtml', title: 'Chapter 2' } });
    expect(bm.body.label).toBe('Chapter 2');
    expect((await u.c.get(`${lib}/items/${item.id}/bookmarks`)).body).toHaveLength(1);
    expect((await u.c.del(`${lib}/items/${item.id}/bookmarks/${bm.body.id}`)).status).toBe(204);
    expect((await u.c.del(`${lib}/items/${item.id}/bookmarks/${bm.body.id}`)).status).toBe(404);
  });

  it('groups books into collections and removes everything with the item', async () => {
    const u = await registered(app, 'collect');
    const lib = `/api/workspaces/${u.workspaceId}/library`;
    const a = (await u.c.post(`${lib}/items`, { book: { title: 'A' } })).body;
    const b = (await u.c.post(`${lib}/items`, { book: { title: 'B' } })).body;
    const col = (await u.c.post(`${lib}/collections`, { name: 'Lighthouses' })).body;
    expect((await u.c.post(`${lib}/collections`, { name: 'Lighthouses' })).status).toBe(409);
    expect((await u.c.post(`${lib}/collections/${col.id}/items`, { itemId: a.id })).status).toBe(204);
    expect((await u.c.post(`${lib}/collections/${col.id}/items`, { itemId: a.id })).status).toBe(204);
    expect((await u.c.get(`${lib}/items?collectionId=${col.id}`)).body.map((i: any) => i.id)).toEqual([a.id]);
    expect((await u.c.get(`${lib}/collections`)).body[0]).toMatchObject({ name: 'Lighthouses', itemCount: 1 });
    expect((await u.c.patch(`${lib}/collections/${col.id}`, { name: 'Signals' })).body.name).toBe('Signals');

    await u.c.post(`${lib}/items/${a.id}/annotations`, { kind: 'HIGHLIGHT', locator: {} });
    expect((await u.c.del(`${lib}/items/${a.id}`)).status).toBe(204);
    expect(await prisma.annotation.count({ where: { itemId: a.id } })).toBe(0);
    expect(await prisma.book.count({ where: { id: a.bookId } })).toBe(0);
    expect((await u.c.get(`${lib}/collections`)).body[0].itemCount).toBe(0);
    expect((await u.c.get(`${lib}/items`)).body.map((i: any) => i.id)).toEqual([b.id]);
    expect((await u.c.del(`${lib}/collections/${col.id}`)).status).toBe(204);
  });

  it('explains a passage bounded at its chapter and stores the cited answer on the run', async () => {
    const u = await registered(app, 'explain');
    const lib = `/api/workspaces/${u.workspaceId}/library`;
    const { sourceId, versionId } = await epubSource(u);
    const item = (await u.c.post(`${lib}/items`, { sourceId })).body;
    const url = `${lib}/items/${item.id}/explain`;

    expect((await u.c.post(url, { mode: 'explain', passage: 'x', locator: { href: 'appendix.xhtml' } })).body.code).toBe('LOCATOR_UNKNOWN');
    expect((await u.c.post(url, { mode: 'ask', passage: 'x', locator: { href: 'chapter-1.xhtml' } })).status).toBe(400);
    expect((await u.c.post(url, { mode: 'reveal', passage: 'x', locator: { href: 'chapter-1.xhtml' } })).status).toBe(400);

    const res = await u.c.post(url, { mode: 'define', passage: 'The archivist read the marginalia.', locator: { href: 'chapter-2.xhtml#p1' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'QUEUED', page: 2, chapterTitle: 'Chapter 2 — The Archivist' });
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: res.body.runId } });
    expect(run).toMatchObject({ graph: 'passage_explain', tier: 'T0', threadId: null, messageId: null });
    expect((run.input as any).params).toMatchObject({ mode: 'define', page: 2, passage: 'The archivist read the marginalia.', itemId: item.id });
    expect((run.scope as any).sourceVersionIds).toEqual([versionId]);

    await app.get(RunExecutorService).execute(res.body.runId);
    expect(units.at(-1).input.params.page).toBe(2);
    const done = await prisma.aiRun.findUniqueOrThrow({ where: { id: res.body.runId } });
    expect(done.status).toBe('SUCCEEDED');
    expect((done.result as any).citations).toEqual([expect.objectContaining({ marker: 'S1', state: 'VALID' })]);
  });

  it('saves a reader excerpt that a research note quotes with a link back to the passage', async () => {
    const u = await registered(app, 'excerpt');
    const base = `/api/workspaces/${u.workspaceId}`;
    const { sourceId } = await epubSource(u);
    const item = (await u.c.post(`${base}/library/items`, { sourceId })).body;
    const ex = await u.c.post(`${base}/library/items/${item.id}/excerpts`, { quote: 'eleven thousand paper books', locator: { href: 'chapter-1.xhtml#p2', locations: { cfi: 'epubcfi(/6/2[ch1]!/4/6)' } } });
    expect(ex.status).toBe(201);
    expect(ex.body).toMatchObject({ sourceId, title: 'Orbit of Small Lanterns', anchor: { itemId: item.id, page: 1, chapterTitle: 'Chapter 1 — The Halcyon Ring' } });

    const m = (await u.c.post(`${base}/manuscripts`, { title: 'Research' })).body;
    const note = await u.c.post(`${base}/manuscripts/${m.id}/research-notes`, { excerptId: ex.body.id });
    expect(note.status).toBe(201);
    expect(note.body.source.anchor.itemId).toBe(item.id);
  });

  it('reports metadata providers as disabled by default', async () => {
    const u = await registered(app, 'meta');
    const res = await u.c.get(`/api/workspaces/${u.workspaceId}/library/metadata/search?q=salt%20year`);
    expect(res.body).toEqual({ enabled: false, providers: [], results: [] });
  });
});
