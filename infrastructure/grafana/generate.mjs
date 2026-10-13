#!/usr/bin/env node
/**
 * Generates the Grafana dashboards (runs, ingestion, ledger, SSE) and alert rules from the specs
 * below, so panel queries stay in step with the metrics the API emits.
 *
 *   node infrastructure/grafana/generate.mjs          write dashboards/*.json and provisioning/alerting
 *   node infrastructure/grafana/generate.mjs --check  fail if committed files are stale, a query
 *                                                     references an fv_* metric the API does not emit,
 *                                                     or an alert links a missing runbook heading
 *
 * Metric names follow Prometheus' OTLP translation: dots become underscores, counters gain
 * `_total`, histograms in seconds gain `_seconds` (+ `_bucket`, `_sum`, `_count`).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const PROM = { type: 'prometheus', uid: 'fv-prometheus' };
const TEMPO = { type: 'tempo', uid: 'fv-tempo' };
const RUNBOOK = 'infrastructure/runbooks';

/** Prometheus series names exported for each OTel instrument in apps/api/src/infra/observability.ts. */
export function emittedMetrics() {
  const src = readFileSync(join(root, 'apps/api/src/infra/observability.ts'), 'utf8');
  const out = new Set();
  const re = /create(Counter|Histogram|UpDownCounter|ObservableGauge)\('([a-z0-9._]+)'(?:,\s*\{([^}]*)\})?/g;
  for (const [, kind, name, opts = ''] of src.matchAll(re)) {
    const base = name.replace(/\./g, '_');
    const seconds = /unit:\s*'s'/.test(opts);
    if (kind === 'Counter') out.add(`${base}_total`);
    else if (kind === 'Histogram') for (const s of ['_bucket', '_sum', '_count']) out.add(`${base}${seconds ? '_seconds' : ''}${s}`);
    else out.add(base);
  }
  // observeGauge() registrations elsewhere in the API.
  const worker = readFileSync(join(root, 'apps/api/src/worker.module.ts'), 'utf8');
  for (const [, name] of worker.matchAll(/observeGauge\('([a-z0-9._]+)'/g)) out.add(name.replace(/\./g, '_'));
  return out;
}

const ts = (title, targets, unit = 'short', w = 12) => ({ type: 'timeseries', title, targets, unit, w, h: 8 });
const stat = (title, expr, unit = 'short') => ({ type: 'stat', title, targets: [{ expr }], unit, w: 6, h: 4 });
const q = (expr, legendFormat) => ({ expr, legendFormat });
const rate = (m, by) => `sum by (${by}) (rate(${m}[$__rate_interval]))`;
const pct = (quantile, m, by = 'le') => `histogram_quantile(${quantile}, sum by (${by}) (rate(${m}[$__rate_interval])))`;

const DASHBOARDS = [
  {
    uid: 'fv-runs',
    title: 'FolioVerse · Runs',
    panels: [
      stat('Runs (1h)', 'sum(increase(fv_runs_total[1h]))'),
      stat('Failed or interrupted (1h)', 'sum(increase(fv_runs_total{status=~"FAILED|INTERRUPTED"}[1h])) / clamp_min(sum(increase(fv_runs_total[1h])), 1)', 'percentunit'),
      stat('Budget rejections (1h)', 'sum(increase(fv_budget_rejections_total[1h]))'),
      stat('p95 run time (1h)', 'histogram_quantile(0.95, sum by (le) (rate(fv_run_duration_seconds_bucket[1h])))', 's'),
      ts('Runs by status', [q(rate('fv_runs_total', 'status'), '{{status}}')], 'ops'),
      ts('Runs by graph', [q(rate('fv_runs_total', 'graph'), '{{graph}}')], 'ops'),
      ts('Run time', [q(pct(0.5, 'fv_run_duration_seconds_bucket'), 'p50'), q(pct(0.95, 'fv_run_duration_seconds_bucket'), 'p95')], 's'),
      ts('Queue depth', [q('max by (queue) (fv_queue_depth)', '{{queue}}')]),
      {
        type: 'table',
        title: 'Recent run traces (web → API → worker → AI service → graph nodes)',
        datasource: TEMPO,
        targets: [{ queryType: 'traceql', query: '{ span.fv.run_id != nil && name =~ "ai-runs run|run .*" }', limit: 20 }],
        w: 24,
        h: 9,
      },
    ],
  },
  {
    uid: 'fv-ingestion',
    title: 'FolioVerse · Ingestion',
    panels: [
      stat('Jobs finished (1h)', 'sum(increase(fv_ingestion_jobs_total[1h]))'),
      stat('Failed or quarantined (1h)', 'sum(increase(fv_ingestion_jobs_total{state=~"FAILED|QUARANTINED"}[1h]))'),
      stat('p95 ingestion time (1h)', 'histogram_quantile(0.95, sum by (le) (rate(fv_ingestion_duration_seconds_bucket[1h])))', 's'),
      stat('Ingestion backlog', 'max(fv_queue_depth{queue="ingestion"})'),
      ts('Jobs by final state', [q(rate('fv_ingestion_jobs_total', 'state'), '{{state}}')], 'ops'),
      ts('Jobs by file type', [q(rate('fv_ingestion_jobs_total', 'mime'), '{{mime}}')], 'ops'),
      ts('Ingestion time', [q(pct(0.5, 'fv_ingestion_duration_seconds_bucket'), 'p50'), q(pct(0.95, 'fv_ingestion_duration_seconds_bucket'), 'p95')], 's'),
      ts('Ingestion queue depth', [q('max(fv_queue_depth{queue="ingestion"})', 'waiting + active + delayed')]),
    ],
  },
  {
    uid: 'fv-ledger',
    title: 'FolioVerse · Ledger',
    panels: [
      stat('Charged, real (24h)', 'sum(increase(fv_ledger_charged_usd_total{is_demo="false"}[24h]))', 'currencyUSD'),
      stat('Charged, DEMO (24h)', 'sum(increase(fv_ledger_charged_usd_total{is_demo="true"}[24h]))', 'currencyUSD'),
      stat('Entries without a price (24h)', 'sum(increase(fv_ledger_entries_total{tier="FINAL_ESTIMATED"}[24h]))'),
      stat('Ledger backlog', 'max(fv_queue_depth{queue="ledger"})'),
      ts('USD charged per hour by cost class', [q('sum by (cost_class, is_demo) (increase(fv_ledger_charged_usd_total[1h]))', '{{cost_class}} demo={{is_demo}}')], 'currencyUSD'),
      ts('Ledger entries by tier', [q(rate('fv_ledger_entries_total', 'tier'), '{{tier}}')], 'ops'),
      ts('Budget rejections by scope', [q(rate('fv_budget_rejections_total', 'scope'), '{{scope}}')], 'ops'),
      ts('Ledger queue depth', [q('max(fv_queue_depth{queue="ledger"})', 'waiting + active + delayed')]),
    ],
  },
  {
    uid: 'fv-sse',
    title: 'FolioVerse · SSE & API',
    panels: [
      stat('Open SSE streams', 'sum(fv_sse_connections)'),
      stat('SSE events/s', 'sum(rate(fv_sse_events_total[5m]))', 'ops'),
      stat('API p95 latency (5m)', 'histogram_quantile(0.95, sum by (le) (rate(http_server_duration_milliseconds_bucket[5m])))', 'ms'),
      stat('API 5xx share (5m)', 'sum(rate(http_server_duration_milliseconds_count{http_status_code=~"5.."}[5m])) / clamp_min(sum(rate(http_server_duration_milliseconds_count[5m])), 1e-9)', 'percentunit'),
      ts('Open SSE streams by kind', [q('sum by (stream) (fv_sse_connections)', '{{stream}}')]),
      ts('SSE events by type', [q(rate('fv_sse_events_total', 'type'), '{{type}}')], 'ops'),
      ts('API latency', [q(pct(0.5, 'http_server_duration_milliseconds_bucket'), 'p50'), q(pct(0.95, 'http_server_duration_milliseconds_bucket'), 'p95')], 'ms', 24),
    ],
  },
];

const ALERTS = [
  {
    uid: 'fv-run-failures',
    title: 'Run failure rate above 20%',
    expr: 'sum(increase(fv_runs_total{status=~"FAILED|INTERRUPTED"}[15m])) / clamp_min(sum(increase(fv_runs_total[15m])), 1)',
    gt: 0.2,
    for: '10m',
    severity: 'warning',
    runbook: 'deploy.md#rollback',
  },
  {
    uid: 'fv-ingestion-failures',
    title: 'More than 5 ingestion failures in 30 minutes',
    expr: 'sum(increase(fv_ingestion_jobs_total{state=~"FAILED|QUARANTINED"}[30m]))',
    gt: 5,
    for: '0m',
    severity: 'warning',
    runbook: 'deploy.md#health-checks',
  },
  {
    uid: 'fv-queue-backlog',
    title: 'Queue backlog above 100 jobs',
    expr: 'max(fv_queue_depth)',
    gt: 100,
    for: '10m',
    severity: 'warning',
    runbook: 'purge-job.md#queue-backlog',
  },
  {
    uid: 'fv-unpriced-usage',
    title: 'Usage recorded without a price',
    expr: 'sum(increase(fv_ledger_entries_total{tier="FINAL_ESTIMATED",is_demo="false"}[1h]))',
    gt: 0,
    for: '0m',
    severity: 'info',
    runbook: 'rotate-secrets.md#model-prices',
  },
  {
    uid: 'fv-spend-spike',
    title: 'Real AI spend above $5 in an hour',
    expr: 'sum(increase(fv_ledger_charged_usd_total{is_demo="false",cost_class="AI_API"}[1h]))',
    gt: 5,
    for: '0m',
    severity: 'critical',
    runbook: 'rotate-secrets.md#suspected-key-abuse',
  },
];

function dashboardJson(d) {
  let x = 0;
  let y = 0;
  let rowH = 0;
  const panels = d.panels.map((p, i) => {
    if (x + p.w > 24) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const gridPos = { h: p.h, w: p.w, x, y };
    x += p.w;
    rowH = Math.max(rowH, p.h);
    const ds = p.datasource ?? PROM;
    return {
      id: i + 1,
      type: p.type,
      title: p.title,
      datasource: ds,
      gridPos,
      targets: p.targets.map((t, j) => ({ refId: String.fromCharCode(65 + j), datasource: ds, ...t })),
      fieldConfig: { defaults: { unit: p.unit ?? 'short' }, overrides: [] },
      options: p.type === 'stat' ? { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, colorMode: 'value', graphMode: 'area' } : {},
    };
  });
  return {
    uid: d.uid,
    title: d.title,
    tags: ['folioverse'],
    timezone: 'browser',
    schemaVersion: 39,
    version: 1,
    editable: true,
    refresh: '30s',
    time: { from: 'now-6h', to: 'now' },
    templating: { list: [] },
    annotations: { list: [] },
    panels,
  };
}

function alertRulesJson() {
  return {
    apiVersion: 1,
    groups: [
      {
        orgId: 1,
        name: 'folioverse',
        folder: 'FolioVerse',
        interval: '1m',
        rules: ALERTS.map((a) => ({
          uid: a.uid,
          title: a.title,
          condition: 'C',
          data: [
            { refId: 'A', relativeTimeRange: { from: 3600, to: 0 }, datasourceUid: PROM.uid, model: { refId: 'A', expr: a.expr, instant: true } },
            {
              refId: 'C',
              datasourceUid: '__expr__',
              model: { refId: 'C', type: 'threshold', expression: 'A', conditions: [{ evaluator: { type: 'gt', params: [a.gt] } }] },
            },
          ],
          noDataState: 'OK',
          execErrState: 'Error',
          for: a.for,
          labels: { severity: a.severity, service: 'folioverse' },
          annotations: { summary: a.title, runbook_url: `${RUNBOOK}/${a.runbook}` },
        })),
      },
    ],
  };
}

const outputs = {
  ...Object.fromEntries(DASHBOARDS.map((d) => [join(here, 'dashboards', `${d.uid.replace(/^fv-/, '')}.json`), dashboardJson(d)])),
  [join(here, 'provisioning', 'alerting', 'folioverse-rules.json')]: alertRulesJson(),
};

function referencedMetrics() {
  const exprs = [...DASHBOARDS.flatMap((d) => d.panels.flatMap((p) => p.targets.map((t) => t.expr ?? ''))), ...ALERTS.map((a) => a.expr)];
  return new Set(exprs.flatMap((e) => e.match(/\bfv_[a-z0-9_]+/g) ?? []));
}

/** GitHub-style heading anchors of a markdown file. */
function anchors(file) {
  const headings = readFileSync(file, 'utf8').match(/^#{1,6} .+$/gm) ?? [];
  return new Set(headings.map((h) => h.replace(/^#+ /, '').trim().toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-')));
}

const check = process.argv.includes('--check');
const problems = [];
const emitted = emittedMetrics();
for (const m of referencedMetrics()) if (!emitted.has(m)) problems.push(`query references ${m}, which the API does not emit`);
for (const a of ALERTS) {
  const [doc, anchor] = a.runbook.split('#');
  const file = join(root, RUNBOOK, doc);
  if (!existsSync(file)) problems.push(`alert ${a.uid} links missing runbook ${RUNBOOK}/${doc}`);
  else if (anchor && !anchors(file).has(anchor)) problems.push(`alert ${a.uid} links ${RUNBOOK}/${a.runbook}, but that heading does not exist`);
}
for (const [file, body] of Object.entries(outputs)) {
  const text = `${JSON.stringify(body, null, 2)}\n`;
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text) problems.push(`${file.slice(root.length + 1)} is stale; run node infrastructure/grafana/generate.mjs`);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}
if (problems.length) {
  for (const p of problems) console.error(`grafana: ${p}`);
  process.exit(1);
}
console.log(`grafana: ${check ? 'ok' : 'wrote'} ${Object.keys(outputs).length} files; ${referencedMetrics().size} fv_* metrics referenced, all emitted`);
