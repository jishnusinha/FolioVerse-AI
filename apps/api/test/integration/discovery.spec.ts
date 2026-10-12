import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resetEnvCache } from '../../src/config/env';
import { PrismaService } from '../../src/infra/prisma.service';
import { catalogPath, loadCatalog, readCatalog, type CatalogRecord } from '../../src/modules/discovery/catalog';
import { DiscoveryService } from '../../src/modules/discovery/discovery.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { RunExecutorService } from '../../src/modules/runs/run-executor.service';
import { createApp, registered } from './harness';

/**
 * Gate 7: taste onboarding, logged recommendation sets (Discover vs Lab), feedback that shelves saved books in
 * the Library, rec_explain runs from logged factors and queued offline evaluations, against a fake AI service.
 */
let app: INestApplication;
let prisma: PrismaService;
let ai: Server;
let catalog: CatalogRecord[];
let failRecommender = false;
const calls: { path: string; body: any }[] = [];
const MISSING = '00000000-0000-4000-8000-000000000000';

function factors() {
  return [
    { key: 'semantic', label: 'Semantic affinity', value: 0.8, weight: 0.35, contribution: 0.28 },
    { key: 'theme', label: 'Theme overlap', value: 0.5, weight: 0.2, contribution: 0.1 },
  ];
}

function recommendations(body: any) {
  const excluded = new Set<string>(body.profile.exclude);
  const k = body.request.k ?? 12;
  const pool = catalog.filter((c) => !excluded.has(c.id) && (!body.request.kind || c.kind === body.request.kind)).slice(0, k - 1);
  const items = [...pool.map((c) => c.id), MISSING].map((id, n) => ({
    id,
    rank: n + 1,
    baseRank: n + 1,
    score: 0.9 - n * 0.01,
    factors: factors(),
    adjustments: n === 1 ? [{ key: 'diversity', label: 'Diversity (MMR)', value: -0.02 }] : [],
    sharedThemes: ['memory'],
    becauseOf: { kind: 'item', id: catalog[0].id, title: catalog[0].title },
    rationale: 'Shares the memory theme.',
  }));
  return {
    modelVersion: 'recsys-hybrid v1',
    weights: body.request.weights ? { semantic: 0.5, tfidf: 0.1, theme: 0.2, preference: 0.15, prior: 0.05 } : { semantic: 0.35, tfidf: 0.2, theme: 0.2, preference: 0.2, prior: 0.05 },
    lambda: body.request.lambda ?? 0.7,
    coldStart: Object.keys(body.profile.positives).length === 0 && !body.profile.query,
    items,
    stages: { candidates: { semantic: 120, tfidf: 80, theme: 64, collaborative: 0, unique: 180 }, eligible: 520, scored: 180, final: items.length },
    profile: { positives: Object.keys(body.profile.positives).length, negatives: body.profile.negatives.length, query: body.profile.query, topThemes: ['memory'] },
    latencyMs: 12.4,
  };
}

beforeAll(async () => {
  ai = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ path: req.url ?? '', body });
      const json = (status: number, data: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
      if (req.url === '/internal/recommendations') {
        if (failRecommender) return json(503, { detail: 'Recommendation model unavailable' });
        return json(200, recommendations(body));
      }
      if (req.url === '/internal/recommendations/similar') {
        const src = catalog.find((c) => c.id === body.itemId)!;
        const others = catalog.filter((c) => c.id !== src.id && (!body.otherKind || c.kind !== src.kind)).slice(0, body.k);
        return json(200, { items: [...others.map((c) => ({ id: c.id, similarity: 0.7, sharedThemes: ['memory'] })), { id: MISSING, similarity: 0.6, sharedThemes: [] }] });
      }
      if (req.url === '/internal/recommendations/model') return json(200, { version: 1, label: 'recsys-hybrid v1', isDemo: true });
      if (req.url === '/internal/recommendations/evaluate') {
        return json(200, { name: 'rec-holdout', modelVersion: 'recsys-hybrid v1', k: body.k, users: 300, isDemo: true, variants: { hybrid_mmr: { ndcg: 0.089 } } });
      }
      if (req.url === '/internal/runs/units') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write(JSON.stringify({ schemaVersion: 1, type: 'run.finished', ts: new Date().toISOString(), data: { status: 'SUCCEEDED', outcome: 'ANSWERED', answer: 'It ranked here on semantic affinity.' } }) + '\n');
        return res.end();
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => ai.listen(0, '127.0.0.1', r));
  process.env.FV_AI_API_URL = `http://127.0.0.1:${(ai.address() as AddressInfo).port}`;
  resetEnvCache();
  app = await createApp();
  prisma = app.get(PrismaService);
  await app.get(ModelsService).ensureSeeded();
  const path = catalogPath();
  if (!path) throw new Error('synthetic catalog not found; run datasets/synthetic/make_catalog.py');
  catalog = readCatalog(path);
  await loadCatalog(prisma, catalog);
  const again = await loadCatalog(prisma, catalog);
  expect(again).toMatchObject({ created: 0, updated: 0 });
});
afterAll(async () => {
  await app?.close();
  await new Promise((r) => ai?.close(r));
});

const book = () => catalog.find((c) => c.kind === 'BOOK')!;
const film = () => catalog.find((c) => c.kind === 'FILM')!;

describe('discovery (gate 7)', () => {
  it('serves the DEMO catalog with onboarding vocabulary and saves a taste profile', async () => {
    const u = await registered(app, 'taste');
    const base = `/api/workspaces/${u.workspaceId}/discover`;
    const taste = await u.c.get(`${base}/taste`);
    expect(taste.status).toBe(200);
    expect(taste.body.profile).toBeNull();
    expect(taste.body.catalogSize).toBeGreaterThanOrEqual(500);
    expect(taste.body.vocabulary.genres.length).toBeGreaterThan(3);
    expect(taste.body.vocabulary.themes[0]).toEqual({ name: expect.any(String), count: expect.any(Number) });
    expect(taste.body.seeds).toHaveLength(24);
    expect(new Set(taste.body.seeds.map((s: any) => s.kind))).toEqual(new Set(['BOOK', 'FILM']));
    expect(taste.body.seeds.every((s: any) => s.isDemo)).toBe(true);

    const seed = taste.body.seeds[0].id;
    const saved = await u.c.send('put', `${base}/taste`, { genres: ['Mystery'], moods: ['Tense'], themes: ['memory'], seedItemIds: [seed, MISSING] });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ genres: ['Mystery'], moods: ['Tense'], seedItemIds: [seed] });
    expect(saved.body.onboardedAt).toBeTruthy();
    expect((await u.c.send('put', `${base}/taste`, { seedItemIds: ['nope'] })).status).toBe(400);

    const list = await u.c.get(`${base}/catalog?kind=FILM&limit=5`);
    expect(list.body.items).toHaveLength(5);
    expect(list.body.items.every((i: any) => i.kind === 'FILM')).toBe(true);
    expect(list.body.total).toBe(catalog.filter((c) => c.kind === 'FILM').length);
    const one = await u.c.get(`${base}/catalog/${book().id}`);
    expect(one.body).toMatchObject({ id: book().id, title: book().title, feedback: { saved: false, rating: null } });
    expect((await u.c.get(`${base}/catalog/${MISSING}`)).status).toBe(404);
  });

  it('logs Discover sets with impressions and Lab sets without them', async () => {
    const u = await registered(app, 'recs');
    const base = `/api/workspaces/${u.workspaceId}/discover`;
    expect((await u.c.get(`${base}/recommendations/latest`)).body).toEqual({ id: null, items: [] });

    const set = await u.c.post(`${base}/recommendations`, { query: 'quiet grief at sea', kind: 'BOOK', k: 6 });
    expect(set.status).toBe(201);
    expect(set.body).toMatchObject({ mode: 'DISCOVER', query: 'quiet grief at sea', modelVersion: 'recsys-hybrid v1', k: 6, lambda: 0.7 });
    expect(set.body.items).toHaveLength(5);
    expect(set.body.stages).toMatchObject({ final: 6, missingFromCatalog: 1 });
    expect(set.body.items[0]).toMatchObject({ rank: 1, factors: factors(), sharedThemes: ['memory'], item: { kind: 'BOOK', isDemo: true } });
    expect(set.body.items[1].adjustments[0].key).toBe('diversity');
    const sent = calls.filter((c) => c.path === '/internal/recommendations').at(-1)!.body;
    expect(sent).toMatchObject({ workspaceId: u.workspaceId, profile: { query: 'quiet grief at sea' }, request: { k: 6, kind: 'BOOK' } });
    expect(sent.request.weights).toBeUndefined();
    expect(await prisma.interaction.count({ where: { setId: set.body.id, kind: 'IMPRESSION' } })).toBe(5);

    const lab = await u.c.post(`${base}/recommendations`, { k: 6, lab: { weights: { semantic: 0.9, prior: 0.5 }, lambda: 0.4, perCreator: 1 } });
    expect(lab.body).toMatchObject({ mode: 'LAB', lambda: 0.4 });
    expect(calls.filter((c) => c.path === '/internal/recommendations').at(-1)!.body.request).toMatchObject({ weights: { semantic: 0.9, prior: 0.5 }, lambda: 0.4, perCreator: 1, balanceMedia: true });
    expect(await prisma.interaction.count({ where: { setId: lab.body.id } })).toBe(0);
    expect((await u.c.post(`${base}/recommendations`, { lab: { weights: { semantic: 2 } } })).status).toBe(400);

    expect((await u.c.get(`${base}/recommendations/latest`)).body.id).toBe(set.body.id);
    expect((await u.c.get(`${base}/recommendations/latest?mode=LAB`)).body.id).toBe(lab.body.id);
    expect((await u.c.get(`${base}/recommendations/${set.body.id}`)).body.items).toHaveLength(5);

    failRecommender = true;
    try {
      const down = await u.c.post(`${base}/recommendations`, {});
      expect(down.status).toBe(503);
      expect(down.body.code).toBe('RECOMMENDER_UNAVAILABLE');
    } finally {
      failRecommender = false;
    }
  });

  it('applies feedback to the profile and shelves saved books in the Library', async () => {
    const u = await registered(app, 'feedback');
    const base = `/api/workspaces/${u.workspaceId}/discover`;
    const b = book();
    const f = film();

    const saved = await u.c.post(`${base}/feedback`, { itemId: b.id, action: 'SAVE' });
    expect(saved.status).toBe(201);
    expect(saved.body.feedback.saved).toBe(true);
    const libraryItemId = saved.body.feedback.libraryItemId;
    expect(libraryItemId).toBeTruthy();
    const shelved = await u.c.get(`/api/workspaces/${u.workspaceId}/library/items/${libraryItemId}`);
    expect(shelved.body).toMatchObject({ status: 'TO_READ', book: { title: b.title, isDemo: true } });
    const again = await u.c.post(`${base}/feedback`, { itemId: b.id, action: 'SAVE' });
    expect(again.body.feedback.libraryItemId).toBe(libraryItemId);
    expect(await prisma.libraryItem.count({ where: { workspaceId: u.workspaceId, userId: u.userId } })).toBe(1);

    const filmSave = await u.c.post(`${base}/feedback`, { itemId: f.id, action: 'SAVE' });
    expect(filmSave.body.feedback).toMatchObject({ saved: true, libraryItemId: null });
    expect((await u.c.get(`${base}/saved`)).body.map((i: any) => i.id).sort()).toEqual([b.id, f.id].sort());

    const other = catalog[5];
    await u.c.post(`${base}/feedback`, { itemId: other.id, action: 'DISLIKE' });
    const dismissed = catalog[6];
    await u.c.post(`${base}/feedback`, { itemId: dismissed.id, action: 'DISMISS', reason: 'Not for me' });
    await u.c.post(`${base}/feedback`, { itemId: catalog[7].id, action: 'CLICK' });

    const profile = await app.get(DiscoveryService).profile(u.workspaceId, u.userId);
    expect(profile.positives).toMatchObject({ [b.id]: 1, [f.id]: 1, [catalog[7].id]: 0.3 });
    expect(profile.negatives.sort()).toEqual([other.id, dismissed.id].sort());
    expect(profile.exclude.sort()).toEqual([b.id, f.id, other.id, dismissed.id].sort());

    await u.c.post(`${base}/feedback`, { itemId: dismissed.id, action: 'UNDISMISS' });
    await u.c.post(`${base}/feedback`, { itemId: other.id, action: 'CLEAR_RATING' });
    const after = await app.get(DiscoveryService).profile(u.workspaceId, u.userId);
    expect(after.negatives).toEqual([]);
    expect(await prisma.interaction.count({ where: { workspaceId: u.workspaceId, userId: u.userId, itemId: other.id } })).toBe(1);

    expect((await u.c.post(`${base}/feedback`, { itemId: b.id, action: 'BOOST' })).status).toBe(400);
    expect((await u.c.post(`${base}/feedback`, { itemId: MISSING, action: 'SAVE' })).status).toBe(404);

    const similar = await u.c.get(`${base}/catalog/${b.id}/similar?otherKind=true`);
    expect(similar.status).toBe(200);
    expect(similar.body.length).toBeGreaterThan(0);
    expect(similar.body.every((s: any) => s.item.kind === 'FILM')).toBe(true);
    expect(similar.body.find((s: any) => s.item.id === f.id).item.feedback.saved).toBe(true);
    expect(similar.body.some((s: any) => s.item.id === MISSING)).toBe(false);
  });

  it('explains a logged recommendation with a rec_explain run built from its recorded factors', async () => {
    const u = await registered(app, 'explain');
    const base = `/api/workspaces/${u.workspaceId}/discover`;
    const set = (await u.c.post(`${base}/recommendations`, { k: 4 })).body;
    const first = set.items[0];
    const res = await u.c.post(`${base}/recommendations/${set.id}/items/${first.itemId}/explain`);
    expect(res.status).toBe(201);
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: res.body.runId } });
    expect(run.graph).toBe('rec_explain');
    expect((run.input as any).params).toMatchObject({ setId: set.id, itemId: first.itemId, factors: factors(), sharedThemes: ['memory'], item: { title: first.item.title } });
    await app.get(RunExecutorService).execute(res.body.runId);
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: res.body.runId } })).status).toBe('SUCCEEDED');
    expect(await prisma.interaction.count({ where: { setId: set.id, kind: 'EXPLAIN' } })).toBe(1);
    expect((await u.c.post(`${base}/recommendations/${set.id}/items/${MISSING}/explain`)).status).toBe(404);
  });

  it('queues an offline evaluation and stores the report from the worker job', async () => {
    const u = await registered(app, 'eval');
    const base = `/api/workspaces/${u.workspaceId}/discover`;
    expect((await u.c.get(`${base}/model`)).body).toMatchObject({ label: 'recsys-hybrid v1', isDemo: true });
    const queued = await u.c.post(`${base}/evaluations`, { k: 10 });
    expect(queued.status).toBe(201);
    expect(queued.body).toMatchObject({ status: 'QUEUED', k: 10 });
    await app.get(DiscoveryService).runEvaluation(queued.body.id);
    const done = (await u.c.get(`${base}/evaluations/${queued.body.id}`)).body;
    expect(done).toMatchObject({ status: 'SUCCEEDED', modelVersion: 'recsys-hybrid v1', report: { users: 300, isDemo: true } });
    await app.get(DiscoveryService).runEvaluation(queued.body.id);
    expect((await u.c.get(`${base}/evaluations`)).body.map((r: any) => r.id)).toEqual([queued.body.id]);
    expect((await u.c.post(`${base}/evaluations`, { k: 50 })).status).toBe(400);
  });

  it('keeps sets, feedback and reports inside their workspace and member', async () => {
    const owner = await registered(app, 'iso-owner');
    const peer = await registered(app, 'iso-peer');
    const outsider = await registered(app, 'iso-out');
    await prisma.workspaceMember.create({ data: { workspaceId: owner.workspaceId, userId: peer.userId, role: 'EDITOR' } });
    const base = `/api/workspaces/${owner.workspaceId}/discover`;
    const set = (await owner.c.post(`${base}/recommendations`, { k: 3 })).body;
    await owner.c.post(`${base}/feedback`, { itemId: book().id, action: 'SAVE' });
    const report = (await owner.c.post(`${base}/evaluations`, {})).body;

    expect((await peer.c.get(`${base}/recommendations/${set.id}`)).status).toBe(404);
    expect((await peer.c.get(`${base}/recommendations/latest`)).body.id).toBeNull();
    expect((await peer.c.get(`${base}/saved`)).body).toEqual([]);
    expect((await peer.c.post(`${base}/recommendations/${set.id}/items/${set.items[0].itemId}/explain`)).status).toBe(404);
    expect((await peer.c.get(`${base}/evaluations/${report.id}`)).status).toBe(200);

    expect((await outsider.c.get(`${base}/taste`)).status).toBe(404);
    expect((await outsider.c.get(`/api/workspaces/${outsider.workspaceId}/discover/recommendations/${set.id}`)).status).toBe(404);
    expect((await outsider.c.get(`/api/workspaces/${outsider.workspaceId}/discover/evaluations/${report.id}`)).status).toBe(404);
  });
});
