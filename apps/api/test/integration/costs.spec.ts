import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { newId } from '../../src/common/ids';
import { PrismaService } from '../../src/infra/prisma.service';
import { DAY_MS, isoDay, utcDay } from '../../src/modules/costs/cost-math';
import { CostRollupService } from '../../src/modules/costs/rollup.service';
import { LedgerService } from '../../src/modules/ledger/ledger.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { createApp, registered } from './harness';

let app: INestApplication;
let prisma: PrismaService;
afterAll(async () => app?.close());

/** Each group gets its own app instance: registration and login are rate limited per app. */
function freshApp() {
  beforeAll(async () => {
    await app?.close();
    app = await createApp();
    prisma = app.get(PrismaService);
    await app.get(ModelsService).ensureSeeded();
  });
}

async function superAdmin() {
  const u = await registered(app, 'admin');
  await prisma.user.update({ where: { id: u.userId }, data: { platformRole: 'SUPER_ADMIN' } });
  expect((await u.c.post('/api/auth/login', { email: u.email, password: u.password })).status).toBe(200);
  return u;
}

/** A model config of its own so prices and reconciliation never touch other tests' data. */
async function isolatedModel(provider = `t${randomBytes(4).toString('hex')}`) {
  const id = `test-${randomBytes(4).toString('hex')}`;
  await prisma.modelConfig.create({ data: { id, provider, model: 'test-model', displayName: 'Test model', contextWindow: 1000, maxOutputTokens: 100, capabilities: ['chat'], isDemo: true } });
  return { id, provider };
}

const final = (workspaceId: string, modelConfigId: string, amount: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
  prisma.costEntry.create({
    data: { id: newId(), workspaceId, modelConfigId, entryType: 'FINAL', tier: 'FINALIZED', costClass: 'AI_API', amount, createdAt, isDemo: true, ...extra },
  });

describe('budgets API', () => {
  freshApp();

  it('creates, validates, edits and deletes budgets', async () => {
    const u = await registered(app, 'budgets');
    const base = `/api/workspaces/${u.workspaceId}/budgets`;
    const initial = await u.c.get(base);
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual([expect.objectContaining({ scope: 'WORKSPACE', current: expect.objectContaining({ remaining: expect.any(String) }) })]);

    expect((await u.c.post(base, { scope: 'PROJECT', limitAmount: '1' })).body.code).toBe('SCOPE_REF_REQUIRED');
    expect((await u.c.post(base, { scope: 'PROJECT', scopeRefId: newId(), limitAmount: '1' })).body.code).toBe('SCOPE_REF_INVALID');
    expect((await u.c.post(base, { scope: 'USER', scopeRefId: newId(), limitAmount: '1' })).body.code).toBe('SCOPE_REF_INVALID');
    expect((await u.c.post(base, { scope: 'WORKSPACE', limitAmount: '1' })).status).toBe(409);
    expect((await u.c.post(base, { scope: 'USER', scopeRefId: u.userId, limitAmount: '-1' })).status).toBe(400);

    const project = u.projects[0];
    const created = await u.c.post(base, { scope: 'PROJECT', scopeRefId: project.id, limitAmount: '2.5', period: 'DAILY', hard: false, alertThresholds: [90, 50, 90] });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ scope: 'PROJECT', label: expect.stringContaining(project.name), period: 'DAILY', hard: false, alertThresholds: [50, 90] });
    expect(created.body.current.limit).toBe('2.5');

    const edited = await u.c.patch(`${base}/${created.body.id}`, { limitAmount: '4', hard: true });
    expect(edited.body).toMatchObject({ hard: true, limit: '4', current: expect.objectContaining({ limit: '4' }) });

    const monthly = await u.c.patch(`${base}/${created.body.id}`, { period: 'MONTHLY' });
    expect(new Date(monthly.body.current.periodEnd).getUTCDate()).toBe(1);

    expect((await u.c.patch(`${base}/${newId()}`, { hard: true })).status).toBe(404);
    expect((await u.c.del(`${base}/${created.body.id}`)).status).toBe(204);
    expect((await u.c.get(base)).body).toHaveLength(1);
    const audit = await prisma.auditEvent.findMany({ where: { workspaceId: u.workspaceId, action: { startsWith: 'budget.' } } });
    expect(audit.map((a) => a.action).sort()).toEqual(['budget.create', 'budget.delete', 'budget.update', 'budget.update']);
  });

  it('refuses to delete a budget that holds open reservations', async () => {
    const u = await registered(app, 'inuse');
    const [ws] = (await u.c.get(`/api/workspaces/${u.workspaceId}/budgets`)).body;
    await prisma.budgetReservation.create({ data: { id: newId(), workspaceId: u.workspaceId, periodId: (await prisma.budgetPeriod.findFirstOrThrow({ where: { policyId: ws.id } })).id, runId: newId(), amount: '0.1' } });
    const res = await u.c.del(`/api/workspaces/${u.workspaceId}/budgets/${ws.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BUDGET_IN_USE');
  });

  it('members see the workspace budget and only their own user budget', async () => {
    const owner = await registered(app, 'owner');
    const member = await registered(app, 'member');
    await prisma.workspaceMember.create({ data: { workspaceId: owner.workspaceId, userId: member.userId, role: 'EDITOR' } });
    const base = `/api/workspaces/${owner.workspaceId}/budgets`;
    await owner.c.post(base, { scope: 'USER', scopeRefId: owner.userId, limitAmount: '3' });
    const mine = await owner.c.post(base, { scope: 'USER', scopeRefId: member.userId, limitAmount: '1' });
    const seen = (await member.c.get(base)).body as any[];
    expect(seen.map((b) => b.scope).sort()).toEqual(['USER', 'WORKSPACE']);
    expect(seen.find((b) => b.scope === 'USER').id).toBe(mine.body.id);
    expect((await member.c.post(base, { scope: 'WORKSPACE', limitAmount: '1' })).status).toBe(403);
  });
});

describe('super admin areas', () => {
  freshApp();

  const routes: [string, string][] = [
    ['get', '/api/admin/models'],
    ['get', '/api/admin/models/registry/diff'],
    ['post', '/api/admin/models/registry/sync'],
    ['patch', '/api/admin/models/mock-grounded'],
    ['post', '/api/admin/models/mock-grounded/prices'],
    ['get', '/api/admin/costs/overview'],
    ['post', '/api/admin/costs/rollup'],
    ['get', '/api/admin/costs/reconciliation'],
    ['post', '/api/admin/costs/reconciliation/import'],
    ['post', '/api/admin/costs/reconciliation/fetch'],
    ['get', '/api/admin/costs/infra'],
    ['post', '/api/admin/costs/infra'],
    ['post', '/api/admin/costs/infra/import-gcp'],
  ];

  it('are invisible (404) to everyone else', async () => {
    const u = await registered(app, 'plain');
    for (const [method, path] of routes) {
      const res = await u.c.send(method as any, path, method === 'get' ? undefined : {});
      expect([method, path, res.status]).toEqual([method, path, 404]);
    }
  });

  it('manages prices: units, currency, source, conflicts and backdating', async () => {
    const a = await superAdmin();
    const { id } = await isolatedModel();
    const url = `/api/admin/models/${id}/prices`;
    const ok = { inputPerMTok: '0.4', outputPerMTok: '1.6', sourceUrl: 'https://example.com/pricing', effectiveFrom: '2026-01-01T00:00:00Z' };
    expect((await a.c.post(url, { ...ok, unit: 'CPU_HOUR' })).body.code).toBe('PRICE_UNIT_MISMATCH');
    expect((await a.c.post(url, { ...ok, outputPerMTok: undefined })).body.code).toBe('OUTPUT_PRICE_REQUIRED');
    expect((await a.c.post(url, { ...ok, currency: 'EUR' })).body.code).toBe('CURRENCY_UNSUPPORTED');
    expect((await a.c.post(url, { ...ok, sourceUrl: 'http://example.com' })).body.code).toBe('SOURCE_URL_REQUIRED');
    expect((await a.c.post(url, { ...ok, sourceUrl: 'demo://seed' })).body.code).toBe('SOURCE_URL_REQUIRED');

    const created = await a.c.post(url, ok);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ unit: 'MTOK', inputPerMTok: '0.4', currency: 'USD', note: null });
    expect((await a.c.post(url, ok)).body.code).toBe('PRICE_EXISTS');

    const { workspaceId } = await registered(app, 'priced');
    await final(workspaceId, id, '0.01', new Date());
    const back = await a.c.post(url, { ...ok, inputPerMTok: '0.5', effectiveFrom: '2026-02-01T00:00:00Z', isDemo: true, sourceUrl: 'demo://test' });
    expect(back.body.note).toMatch(/keep the price/);
    const future = await a.c.post(url, { ...ok, effectiveFrom: '2099-01-01T00:00:00Z' });
    expect(future.status).toBe(201);

    const models = (await a.c.get('/api/admin/models')).body as any[];
    const mine = models.find((m) => m.id === id);
    expect(mine.prices.map((p: any) => p.inputPerMTok)).toEqual(['0.4', '0.5', '0.4']);
    expect(mine.prices[0].scheduled).toBe(true);
    expect(mine.currentPriceId).toBe(back.body.id);
    expect(await prisma.auditEvent.count({ where: { actorId: a.userId, action: 'model.price_add' } })).toBe(3);
  });

  it('verifies models, moves the default flag and diffs the registry', async () => {
    const a = await superAdmin();
    const { id } = await isolatedModel();
    const before = await prisma.modelConfig.findFirst({ where: { isDefault: true } });
    expect((await a.c.patch(`/api/admin/models/${id}`, { status: 'VERIFIED', isDefault: true })).body).toMatchObject({ status: 'VERIFIED', isDefault: true });
    expect(await prisma.modelConfig.count({ where: { isDefault: true } })).toBe(1);
    expect((await a.c.patch('/api/admin/models/local-compute', { isDefault: true })).body.code).toBe('NOT_CHAT_MODEL');
    expect((await a.c.patch('/api/admin/models/nope', { status: 'VERIFIED' })).status).toBe(404);
    if (before) await prisma.modelConfig.update({ where: { id: before.id }, data: { isDefault: true } });
    await prisma.modelConfig.update({ where: { id }, data: { isDefault: false } });

    const diff = (await a.c.get('/api/admin/models/registry/diff')).body;
    expect(diff.removed.map((r: any) => r.id)).toContain(id);
    expect(diff).toEqual(expect.objectContaining({ added: expect.any(Array), changed: expect.any(Array) }));
    const sync = await a.c.post('/api/admin/models/registry/sync');
    expect(sync.status).toBe(200);
    expect(sync.body.created).toEqual(expect.any(Array));
  });

  it('prices local compute per CPU-hour', async () => {
    const a = await superAdmin();
    const from = new Date(Date.now() - 60_000);
    const price = await a.c.post('/api/admin/models/local-compute/prices', { inputPerMTok: '0.036', sourceUrl: 'demo://test-cpu-rate', isDemo: true, effectiveFrom: from.toISOString() });
    expect(price.status).toBe(201);
    expect(price.body).toMatchObject({ unit: 'CPU_HOUR', outputPerMTok: '0' });

    const u = await registered(app, 'local');
    const id = newId();
    await prisma.usageEvent.create({
      data: { id, workspaceId: u.workspaceId, costClass: 'LOCAL_COMPUTE', provider: 'local', model: 'cpu-embedding', modelConfigId: 'local-compute', computeSeconds: 100, feature: 'ingestion' },
    });
    await app.get(LedgerService).processUsageEvent(id);
    const e = await prisma.costEntry.findFirstOrThrow({ where: { usageEventId: id } });
    // 100 s × 0.036 / 3600
    expect(e).toMatchObject({ costClass: 'LOCAL_COMPUTE', tier: 'FINALIZED' });
    expect(e.amount.toString()).toBe('0.001');

    const sum = (await u.c.get(`/api/workspaces/${u.workspaceId}/costs/summary`)).body;
    expect(sum.total).toBe('0.00000000');
    expect(sum.localCompute).toEqual({ amount: '0.00100000', seconds: 100, priced: true });
    expect(sum.byClass).toEqual([{ key: 'LOCAL_COMPUTE', amount: '0.00100000' }]);
    const budget = (await u.c.get(`/api/workspaces/${u.workspaceId}/budgets`)).body[0];
    expect(Number(budget.current.spent)).toBe(0);
  });
});

describe('reconciliation', () => {
  freshApp();

  it('reconciles a closed day within tolerance and allocates a variance pro rata', async () => {
    const a = await superAdmin();
    const { workspaceId } = await registered(app, 'recon');
    const { id: model, provider } = await isolatedModel();
    const today = utcDay(new Date());
    const d3 = new Date(today.getTime() - 3 * DAY_MS + 12 * 3600_000);
    const d4 = new Date(today.getTime() - 4 * DAY_MS + 12 * 3600_000);
    const runId = newId();
    const a1 = await final(workspaceId, model, '0.1', d3);
    await final(workspaceId, model, '0.3', d3);
    const v1 = await final(workspaceId, model, '0.1', d4, { runId });
    const v2 = await final(workspaceId, model, '0.3', d4);

    const csv = `date,amount\n${isoDay(d3)},0.405\n${isoDay(d4)},0.50\n${isoDay(today)},1`;
    const res = await a.c.post('/api/admin/costs/reconciliation/import', { provider, csv });
    expect(res.status).toBe(200);
    const byDay = Object.fromEntries(res.body.results.map((r: any) => [r.day, r]));
    expect(byDay[isoDay(d3)]).toMatchObject({ status: 'RECONCILED', ledger: '0.40000000', variance: '0.00500000', entries: 2 });
    expect(byDay[isoDay(d4)]).toMatchObject({ status: 'VARIANCE', variance: '0.10000000' });
    expect(byDay[isoDay(today)]).toMatchObject({ status: 'SKIPPED', reason: 'DAY_NOT_CLOSED' });

    const rec = await prisma.costEntry.findFirstOrThrow({ where: { supersedesEntryId: a1.id } });
    expect(rec).toMatchObject({ entryType: 'RECONCILIATION', tier: 'RECONCILED', workspaceId });
    expect(rec.amount.toString()).toBe('0');
    const vars = await prisma.costEntry.findMany({ where: { supersedesEntryId: { in: [v1.id, v2.id] } } });
    expect(vars.map((v) => [v.supersedesEntryId, v.entryType, v.amount.toString()]).sort()).toEqual(
      [
        [v1.id, 'VARIANCE', '0.025'],
        [v2.id, 'VARIANCE', '0.075'],
      ].sort(),
    );
    const totals = await app.get(LedgerService).runTotals(runId);
    expect(totals).toMatchObject({ total: '0.12500000', tier: 'VARIANCE' });

    const again = await a.c.post('/api/admin/costs/reconciliation/import', { provider, csv: `date,amount\n${isoDay(d3)},0.405\n${isoDay(d4)},0.9` });
    expect(again.body.results).toEqual([
      expect.objectContaining({ day: isoDay(d4), status: 'CONFLICT', reason: 'ALREADY_RECONCILED' }),
      expect.objectContaining({ day: isoDay(d3), status: 'RECONCILED', reason: 'UNCHANGED' }),
    ]);
    expect(await prisma.costEntry.count({ where: { supersedesEntryId: { in: [a1.id, v1.id, v2.id] } } })).toBe(3);

    const list = (await a.c.get('/api/admin/costs/reconciliation?days=7')).body;
    const rows = list.rows.filter((r: any) => r.provider === provider);
    expect(rows.map((r: any) => [r.day, r.status])).toEqual([
      [isoDay(d3), 'RECONCILED'],
      [isoDay(d4), 'VARIANCE'],
    ]);
    expect(list.apiConfigured).toEqual({ openai: false });
  });

  it('rejects unreadable files and reports the unconfigured OpenAI and GCP imports', async () => {
    const a = await superAdmin();
    const bad = await a.c.post('/api/admin/costs/reconciliation/import', { provider: 'openai', csv: 'when,how\nx,y' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('CSV_INVALID');
    const fetch = await a.c.post('/api/admin/costs/reconciliation/fetch', { provider: 'openai' });
    expect(fetch.status).toBe(503);
    expect(fetch.body.code).toBe('RECONCILIATION_UNCONFIGURED');
    const gcp = await a.c.post('/api/admin/costs/infra/import-gcp', {});
    expect(gcp.status).toBe(503);
    expect(gcp.body.code).toBe('GCP_BILLING_UNCONFIGURED');
  });
});

describe('rollups, anomalies and the admin overview', () => {
  freshApp();

  it('rolls up idempotently and flags a spike against the 14-day baseline', async () => {
    const a = await superAdmin();
    const u = await registered(app, 'spiky');
    const today = utcDay(new Date());
    for (let i = 1; i <= 14; i++) await final(u.workspaceId, 'mock-grounded', i % 2 ? '1.0' : '1.2', new Date(today.getTime() - i * DAY_MS + 3600_000), { feature: 'grounded_qa', userId: u.userId });
    // Large enough to stay in the overview's top 8 workspaces in the shared test database.
    await final(u.workspaceId, 'mock-grounded', '900', new Date(Math.min(Date.now(), today.getTime() + 60_000)), { feature: 'grounded_qa', userId: u.userId });

    const first = await a.c.post('/api/admin/costs/rollup', { days: 16 });
    expect(first.status).toBe(200);
    const rollups = () => prisma.costRollup.findMany({ where: { workspaceId: u.workspaceId, granularity: 'DAY', dimension: 'total' }, orderBy: { bucketStart: 'asc' } });
    const once = await rollups();
    expect(once).toHaveLength(15);
    await app.get(CostRollupService).rollup(16);
    const twice = await rollups();
    expect(twice.map((r) => r.amount.toString())).toEqual(once.map((r) => r.amount.toString()));
    expect(twice.at(-1)!.amount.toString()).toBe('900');

    const anomalies = await prisma.costAnomaly.findMany({ where: { workspaceId: u.workspaceId } });
    expect(anomalies.map((x) => `${x.dimension}:${x.key}`).sort()).toEqual(['feature:grounded_qa', 'total:all']);
    expect(anomalies[0].zScore).toBeGreaterThan(3);
    expect(await prisma.notification.count({ where: { workspaceId: u.workspaceId, kind: 'COST_ANOMALY' } })).toBe(2);
    await app.get(CostRollupService).detectAnomalies();
    expect(await prisma.costAnomaly.count({ where: { workspaceId: u.workspaceId } })).toBe(2);

    const listed = (await u.c.get(`/api/workspaces/${u.workspaceId}/costs/anomalies`)).body;
    expect(listed).toHaveLength(2);

    const overview = (await a.c.get('/api/admin/costs/overview?days=30')).body;
    expect(overview.daily).toHaveLength(30);
    expect(overview.topWorkspaces.map((w: any) => w.workspaceId)).toContain(u.workspaceId);
    expect(overview.anomalies.length).toBeGreaterThan(0);
    expect(Number(overview.totals.platform)).toBeGreaterThanOrEqual(Number(overview.totals.aiApi));
    const filtered = (await a.c.get('/api/admin/costs/overview?days=30&model=mock-grounded')).body;
    expect(filtered.topUsers).toEqual([]);
    expect(filtered.byModel.every((m: any) => m.key === 'mock-grounded')).toBe(true);
  });

  it('records manual cloud costs with validation', async () => {
    const a = await superAdmin();
    const day = isoDay(new Date(Date.now() - DAY_MS));
    const ok = await a.c.post('/api/admin/costs/infra', { day, service: `Cloud Run ${randomBytes(3).toString('hex')}`, amount: '1.25', isDemo: true, note: 'test' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ amount: '1.25', source: 'MANUAL', isDemo: true });
    expect((await a.c.post('/api/admin/costs/infra', { day: '2999-01-01', service: 'x', amount: '1' })).body.code).toBe('INVALID_DAY');
    expect((await a.c.post('/api/admin/costs/infra', { day, service: 'x', amount: '1', currency: 'EUR' })).body.code).toBe('CURRENCY_UNSUPPORTED');
    expect((await a.c.post('/api/admin/costs/infra', { day, service: 'x', amount: '-1' })).status).toBe(400);
    const infra = (await a.c.get('/api/admin/costs/infra?days=7')).body;
    expect(infra.gcpConfigured).toBe(false);
    expect(infra.rows.map((r: any) => r.id)).toContain(ok.body.id);
    const overview = (await a.c.get('/api/admin/costs/overview?days=7')).body;
    expect(Number(overview.daily.find((d: any) => d.date === day).cloudInfra)).toBeGreaterThanOrEqual(1.25);
  });
});

describe('workspace cost views', () => {
  freshApp();

  it('estimates calls at the current price', async () => {
    const u = await registered(app, 'estimate');
    const res = await u.c.post(`/api/workspaces/${u.workspaceId}/costs/estimate`, { modelConfigId: 'mock-grounded', calls: 10, inputTokens: 1000, outputTokens: 500 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ perCall: '0.00125000', total: '0.01250000', status: 'PRICED', price: expect.objectContaining({ isDemo: true }) });
    const missing = await u.c.post(`/api/workspaces/${u.workspaceId}/costs/estimate`, { modelConfigId: 'no-such-model', inputTokens: 1, outputTokens: 1 });
    expect(missing.body).toMatchObject({ total: '0.00000000', status: 'PRICE_MISSING', price: null });
  });

  it('breaks spend down by project and user, hides people from non-admins, and exports CSV safely', async () => {
    const owner = await registered(app, 'summary');
    const viewer = await registered(app, 'viewer');
    await prisma.workspaceMember.create({ data: { workspaceId: owner.workspaceId, userId: viewer.userId, role: 'VIEWER' } });
    const runId = newId();
    const project = owner.projects[0];
    await prisma.aiRun.create({
      data: { id: runId, workspaceId: owner.workspaceId, userId: owner.userId, graph: 'grounded_qa', tier: 'standard', status: 'SUCCEEDED', input: {}, scope: { projectId: project.id } },
    });
    await final(owner.workspaceId, 'mock-grounded', '0.2', new Date(), { runId, userId: owner.userId, feature: 'grounded_qa', reason: '=HYPERLINK("x")' });

    const sum = (await owner.c.get(`/api/workspaces/${owner.workspaceId}/costs/summary?days=7`)).body;
    expect(sum).toMatchObject({ days: 7, total: '0.20000000', byProject: [{ key: project.name, amount: '0.20000000' }], byUser: [{ key: 'summary', amount: '0.20000000' }] });
    expect(sum.daily).toHaveLength(7);
    expect(sum.budgets).toHaveLength(1);
    const filtered = (await owner.c.get(`/api/workspaces/${owner.workspaceId}/costs/summary?model=other-model`)).body;
    expect(filtered.total).toBe('0.00000000');
    const asViewer = (await viewer.c.get(`/api/workspaces/${owner.workspaceId}/costs/summary`)).body;
    expect(asViewer.byUser).toBeNull();

    const csv = await owner.c.get(`/api/workspaces/${owner.workspaceId}/costs/export.csv?days=7`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const [header, row] = csv.text.trim().split('\n');
    expect(header).toContain('entry_id');
    expect(header).toContain('supersedes_entry_id');
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
