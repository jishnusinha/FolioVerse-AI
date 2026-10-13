import { Decimal } from 'decimal.js';
import { allocate, anomalyScore, parseProviderCsv } from '../../src/modules/costs/cost-math';
import { fetchGcpBilling, fetchOpenAiDailyCosts, gcpBillingQuery, IntegrationError } from '../../src/modules/costs/providers';
import { periodBounds } from '../../src/modules/ledger/budget.service';
import { settledTier } from '../../src/modules/ledger/ledger.service';
import { registryDiff, SeedEntry } from '../../src/modules/models/seed-models';

const opts = { z: 3, minAmount: 0.01, minDays: 7 };

describe('anomalyScore', () => {
  it('needs enough baseline days with spend', () => {
    expect(anomalyScore([0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], 50, opts)).toBeNull();
  });

  it('flags a spike and ignores ordinary variation', () => {
    const base = [1, 1.2, 0.9, 1.1, 1, 0.8, 1.05, 1, 1.1, 0.95, 1, 1.2, 0.9, 1];
    expect(anomalyScore(base, 1.15, opts)!.flagged).toBe(false);
    const spike = anomalyScore(base, 5, opts)!;
    expect(spike.flagged).toBe(true);
    expect(spike.z).toBeGreaterThan(3);
  });

  it('floors the deviation of a flat history at 10% of the mean', () => {
    const flat = Array(14).fill(2);
    const r = anomalyScore(flat, 2.1, opts)!;
    expect(r.std).toBe(0);
    expect(r.z).toBeCloseTo(0.5);
    expect(r.flagged).toBe(false);
  });

  it('never flags a drop or an amount under the noise floor', () => {
    const base = Array(14).fill(0.001);
    expect(anomalyScore(base, 0.009, opts)!.flagged).toBe(false);
    expect(anomalyScore(Array(14).fill(5), 0, opts)!.flagged).toBe(false);
  });
});

describe('allocate', () => {
  const sum = (xs: Decimal[]) => xs.reduce((a, b) => a.plus(b), new Decimal(0)).toFixed(8);

  it('splits pro rata and always sums to the total', () => {
    const parts = allocate('0.10000000', ['1', '1', '1']);
    expect(sum(parts)).toBe('0.10000000');
    expect(parts.map((p) => p.toFixed(8))).toEqual(['0.03333334', '0.03333333', '0.03333333']);
  });

  it('gives the remainder to the largest weight and handles negatives and zero weights', () => {
    const parts = allocate('-0.07', ['0.01', '0.05', '0']);
    expect(sum(parts)).toBe('-0.07000000');
    expect(parts[2].toFixed(8)).toBe('0.00000000');
    const even = allocate('1', ['0', '0']);
    expect(even.map((p) => p.toFixed(8))).toEqual(['0.50000000', '0.50000000']);
    expect(allocate('1', [])).toEqual([]);
  });
});

describe('parseProviderCsv', () => {
  it('accepts common column names, sums rows per day, strips a BOM and $ signs', () => {
    const r = parseProviderCsv('\uFEFFDate,Cost,Currency\n2026-10-01,$1.50,usd\n2026-10-01,0.25,USD\n2026-10-02T00:00:00Z,"2",USD\n');
    expect(r.errors).toEqual([]);
    expect(r.days).toEqual([
      { day: '2026-10-01', amount: '1.75000000', currency: 'USD' },
      { day: '2026-10-02', amount: '2.00000000', currency: 'USD' },
    ]);
  });

  it('reads unix timestamps (OpenAI start_time) and reports bad rows', () => {
    const r = parseProviderCsv('start_time,amount_value\n1790812800,0.5\nnot-a-date,1\n1790812800,abc');
    expect(r.days).toEqual([{ day: '2026-10-01', amount: '0.50000000', currency: 'USD' }]);
    expect(r.errors).toHaveLength(2);
  });

  it('rejects unknown headers, empty files and mixed currencies', () => {
    expect(parseProviderCsv('when,how_much\n2026-10-01,1').days).toEqual([]);
    expect(parseProviderCsv('').errors).toEqual(['The file is empty']);
    const mixed = parseProviderCsv('date,amount,currency\n2026-10-01,1,USD\n2026-10-01,1,EUR');
    expect(mixed.errors[0]).toMatch(/mixed currencies/);
  });
});

describe('settledTier', () => {
  const fin = (tier = 'FINALIZED') => ({ entryType: 'FINAL', tier });
  it('orders estimate < final < reconciled, with variance winning', () => {
    expect(settledTier([], true)).toBe('PREFLIGHT_ESTIMATE');
    expect(settledTier([fin()], true)).toBe('FINALIZED');
    expect(settledTier([fin('FINAL_ESTIMATED')], false)).toBe('FINAL_ESTIMATED');
    expect(settledTier([fin(), fin(), { entryType: 'RECONCILIATION', tier: 'RECONCILED' }], false)).toBe('FINALIZED');
    expect(settledTier([fin(), { entryType: 'RECONCILIATION', tier: 'RECONCILED' }], false)).toBe('RECONCILED');
    expect(settledTier([fin(), { entryType: 'VARIANCE', tier: 'VARIANCE' }], false)).toBe('VARIANCE');
  });
});

describe('periodBounds', () => {
  it('uses UTC calendar days and months', () => {
    const now = new Date('2026-12-31T23:30:00Z');
    expect(periodBounds('DAILY', now)).toEqual({ start: new Date('2026-12-31T00:00:00Z'), end: new Date('2027-01-01T00:00:00Z') });
    expect(periodBounds('MONTHLY', now)).toEqual({ start: new Date('2026-12-01T00:00:00Z'), end: new Date('2027-01-01T00:00:00Z') });
  });
});

describe('registryDiff', () => {
  const seed = (over: Partial<SeedEntry>): SeedEntry => ({
    id: 'a',
    provider: 'mock',
    model: 'mock-1',
    envVar: null,
    displayName: 'A',
    contextWindow: 1000,
    maxOutputTokens: 100,
    capabilities: ['chat', 'json'],
    fallbacks: [],
    isDemo: true,
    ...over,
  });
  const db = (over: Record<string, unknown> = {}) => ({
    id: 'a',
    provider: 'mock',
    model: 'mock-1',
    displayName: 'A',
    contextWindow: 1000,
    maxOutputTokens: 100,
    capabilities: ['json', 'chat'],
    fallbackIds: [],
    isDemo: true,
    ...over,
  });

  it('reports added, removed and changed entries', () => {
    const d = registryDiff(
      [seed({}), seed({ id: 'b', provider: 'openai', model: null, envVar: 'FV_OPENAI_CHAT_MODEL', displayName: 'B' })],
      [db({ displayName: 'Old A', contextWindow: 500 }), db({ id: 'gone' })],
    );
    expect(d.added).toEqual([{ id: 'b', provider: 'openai', displayName: 'B', blockedBy: 'FV_OPENAI_CHAT_MODEL' }]);
    expect(d.removed.map((r) => r.id)).toEqual(['gone']);
    expect(d.changed).toEqual([
      {
        id: 'a',
        fields: [
          { field: 'displayName', seed: 'A', db: 'Old A' },
          { field: 'contextWindow', seed: 1000, db: 500 },
        ],
      },
    ]);
  });

  it('ignores capability order and an unresolved env model id', () => {
    expect(registryDiff([seed({ model: null, envVar: 'X' })], [db()]).changed).toEqual([]);
  });
});

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe('fetchOpenAiDailyCosts', () => {
  it('pages through the costs API and sums line items per day', async () => {
    const calls: string[] = [];
    const pages = [
      {
        data: [{ start_time: 1790812800, results: [{ amount: { value: 0.5, currency: 'usd' } }, { amount: { value: 0.25, currency: 'usd' } }] }],
        has_more: true,
        next_page: 'p2',
      },
      { data: [{ start_time: 1790899200, results: [] }], has_more: false, next_page: null },
    ];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push(url);
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
      return json(pages[calls.length - 1]);
    }) as unknown as typeof fetch;
    const days = await fetchOpenAiDailyCosts('test-key', new Date('2026-10-01'), new Date('2026-10-03'), fetchImpl);
    expect(days).toEqual([
      { day: '2026-10-01', amount: '0.75000000', currency: 'USD' },
      { day: '2026-10-02', amount: '0.00000000', currency: 'USD' },
    ]);
    expect(calls[0]).toContain('bucket_width=1d');
    expect(calls[1]).toContain('page=p2');
  });

  it('turns HTTP errors into an integration error without the key', async () => {
    const fetchImpl = (async () => json({}, 401)) as unknown as typeof fetch;
    const err = await fetchOpenAiDailyCosts('secret-key', new Date(), new Date(), fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(IntegrationError);
    expect(err.code).toBe('PROVIDER_REPORT_FAILED');
    expect(String(err.message)).not.toContain('secret-key');
  });
});

describe('GCP billing export', () => {
  it('validates the table name', () => {
    expect(() => gcpBillingQuery('bad table; DROP')).toThrow(IntegrationError);
    expect(gcpBillingQuery('proj-1.billing.gcp_billing_export_v1_X')).toContain('`proj-1.billing.gcp_billing_export_v1_X`');
  });

  it('queries BigQuery with a date parameter and maps rows', async () => {
    let sent: any;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://bigquery.googleapis.com/bigquery/v2/projects/proj-1/queries');
      sent = JSON.parse(String(init.body));
      return json({ jobComplete: true, rows: [{ f: [{ v: '2026-10-01' }, { v: 'Cloud Run' }, { v: 'usd' }, { v: '1.2345' }] }] });
    }) as unknown as typeof fetch;
    const rows = await fetchGcpBilling('proj-1.billing.export', new Date('2026-09-01'), { fetchImpl, token: 't' });
    expect(sent.queryParameters[0].parameterValue.value).toBe('2026-09-01');
    expect(sent.useLegacySql).toBe(false);
    expect(rows).toEqual([{ day: '2026-10-01', service: 'Cloud Run', currency: 'USD', amount: '1.23450000' }]);
  });

  it('is unconfigured off GCP (no metadata server)', async () => {
    const fetchImpl = (async () => {
      throw new Error('ENOTFOUND');
    }) as unknown as typeof fetch;
    const err = await fetchGcpBilling('p.d.t', new Date(), { fetchImpl }).catch((e) => e);
    expect(err.code).toBe('GCP_BILLING_UNCONFIGURED');
  });
});
