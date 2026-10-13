import { Decimal } from 'decimal.js';
import { isoDay, ProviderDay, utcDay } from './cost-math';

type Fetch = typeof fetch;

export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * Daily organization costs from the OpenAI Costs API (`GET /v1/organization/costs`, 1-day buckets). Requires an
 * admin key; amounts per bucket are summed across line items.
 */
export async function fetchOpenAiDailyCosts(adminKey: string, since: Date, until: Date, fetchImpl: Fetch = fetch): Promise<ProviderDay[]> {
  const byDay = new Map<string, { amount: Decimal; currency: string }>();
  let page: string | null = null;
  for (let i = 0; i < 20; i++) {
    const qs = new URLSearchParams({
      start_time: String(Math.floor(since.getTime() / 1000)),
      end_time: String(Math.floor(until.getTime() / 1000)),
      bucket_width: '1d',
      limit: '31',
    });
    if (page) qs.set('page', page);
    const r = await fetchImpl(`https://api.openai.com/v1/organization/costs?${qs}`, {
      headers: { authorization: `Bearer ${adminKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new IntegrationError(`OpenAI costs request failed with HTTP ${r.status}`, 'PROVIDER_REPORT_FAILED');
    const body = (await r.json()) as { data?: any[]; has_more?: boolean; next_page?: string | null };
    for (const bucket of body.data ?? []) {
      const day = isoDay(utcDay(Number(bucket.start_time) * 1000));
      for (const res of bucket.results ?? []) {
        const value = res?.amount?.value;
        if (value === undefined || value === null) continue;
        const currency = String(res.amount.currency ?? 'usd').toUpperCase();
        const prev = byDay.get(day);
        byDay.set(day, { amount: (prev?.amount ?? new Decimal(0)).plus(String(value)), currency });
      }
      if (!byDay.has(day)) byDay.set(day, { amount: new Decimal(0), currency: 'USD' });
    }
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, amount: v.amount.toFixed(8), currency: v.currency }));
}

export interface InfraDay {
  day: string;
  service: string;
  amount: string;
  currency: string;
}

const TABLE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_$]+$/;

/** Daily spend per service from a Cloud Billing export table, net of credits. */
export function gcpBillingQuery(table: string) {
  if (!TABLE.test(table)) throw new IntegrationError('FV_GCP_BILLING_TABLE must look like project.dataset.table', 'GCP_BILLING_UNCONFIGURED');
  return [
    "SELECT FORMAT_DATE('%F', DATE(usage_start_time)) AS day, service.description AS service, currency,",
    '  SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS amount',
    `FROM \`${table}\``,
    'WHERE DATE(usage_start_time) >= @since',
    'GROUP BY day, service, currency',
    'ORDER BY day',
  ].join('\n');
}

/** Access token of the runtime service account (Cloud Run metadata server). */
async function metadataToken(fetchImpl: Fetch) {
  const r = await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
    signal: AbortSignal.timeout(3000),
  }).catch(() => null);
  if (!r?.ok) throw new IntegrationError('No Google credentials: the GCP billing import runs only on GCP with a service account', 'GCP_BILLING_UNCONFIGURED');
  return ((await r.json()) as { access_token: string }).access_token;
}

/** Runs the billing query through the BigQuery REST API (`jobs.query`). */
export async function fetchGcpBilling(table: string, since: Date, opts: { project?: string; fetchImpl?: Fetch; token?: string } = {}): Promise<InfraDay[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const query = gcpBillingQuery(table);
  const project = opts.project || table.split('.')[0];
  const token = opts.token ?? (await metadataToken(fetchImpl));
  const r = await fetchImpl(`https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}/queries`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query,
      useLegacySql: false,
      parameterMode: 'NAMED',
      queryParameters: [{ name: 'since', parameterType: { type: 'DATE' }, parameterValue: { value: isoDay(since) } }],
      timeoutMs: 30_000,
    }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!r.ok) throw new IntegrationError(`BigQuery request failed with HTTP ${r.status}`, 'GCP_BILLING_FAILED');
  const body = (await r.json()) as { jobComplete?: boolean; rows?: { f: { v: string | null }[] }[] };
  if (body.jobComplete === false) throw new IntegrationError('The billing query did not finish in time; try again', 'GCP_BILLING_FAILED');
  return (body.rows ?? []).map(({ f }) => ({
    day: String(f[0].v),
    service: String(f[1].v ?? 'Unknown service'),
    currency: String(f[2].v ?? 'USD').toUpperCase(),
    amount: new Decimal(f[3].v ?? '0').toFixed(8),
  }));
}
