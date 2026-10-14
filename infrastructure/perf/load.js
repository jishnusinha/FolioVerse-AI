/**
 * k6 load test (plan G13-PERF-004): 50 concurrent SSE run streams and 20 concurrent ingestions against a running
 * stack. Uses the deterministic mock model unless the server has a live provider configured (it never sets keys).
 *
 *   node infrastructure/scripts/perf.mjs [--base http://localhost:3000]
 *
 * k6's HTTP client reads a response to the end, so one SSE request lasts from "run accepted" to the terminal event:
 * `sse_stream` is the full streamed run, `http_req_waiting` on it is time to the first byte of the stream.
 */
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.FV_BASE || 'http://localhost:3000';
const SSE_VUS = Number(__ENV.FV_SSE_VUS || 50);
const INGEST_VUS = Number(__ENV.FV_INGEST_VUS || 20);

const runCreate = new Trend('run_create', true);
const sseFirstByte = new Trend('sse_first_byte', true);
const sseStream = new Trend('sse_stream', true);
const ingestReady = new Trend('ingest_ready', true);
const failures = new Counter('fv_failures');

export const options = {
  scenarios: {
    sse: { executor: 'per-vu-iterations', vus: SSE_VUS, iterations: 1, maxDuration: '5m', exec: 'streamRun' },
    ingest: { executor: 'per-vu-iterations', vus: INGEST_VUS, iterations: 1, maxDuration: '5m', exec: 'ingest' },
  },
  thresholds: {
    run_create: ['p(95)<1000'],
    sse_first_byte: ['p(95)<1000'],
    sse_stream: ['p(95)<10000'],
    ingest_ready: ['p(95)<60000'],
    fv_failures: ['count<1'],
    checks: ['rate>0.99'],
  },
  setupTimeout: '3m',
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'max', 'count'],
};

const DOC = `# Load test brief (DEMO)

The outlook projects 14.2% annual growth in its base case through 2030, driven by enterprise adoption.
Procurement cycles shortened to 90 days in 2025 as buyers standardised vendor reviews.
Supply chain concentration remains a risk because two vendors provide most accelerator capacity.
`;

function cookieOf(res, name) {
  const c = res.cookies[name];
  return c && c.length ? c[0].value : null;
}

function headers(s, extra = {}) {
  return { cookie: `fv_at=${s.at}; fv_rt=${s.rt}; fv_csrf=${s.csrf}`, 'x-csrf-token': s.csrf, 'content-type': 'application/json', ...extra };
}

function ok(res, name) {
  const passed = check(res, { [`${name} 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  if (!passed) {
    failures.add(1, { step: name });
    console.error(`${name} -> ${res.status} ${String(res.body).slice(0, 200)}`);
  }
  return passed;
}

function upload(s, title, text) {
  const ws = `${BASE}/api/workspaces/${s.wid}`;
  const up = http.post(`${ws}/uploads`, JSON.stringify({ projectId: s.projectId, filename: `${title}.md`, sizeBytes: text.length }), { headers: headers(s) });
  if (!ok(up, 'upload create')) return null;
  const u = up.json();
  const target = u.mode === 'proxy' ? `${BASE}${u.url}` : u.url;
  const put = http.put(target, text, { headers: u.mode === 'proxy' ? { ...headers(s), ...u.headers } : u.headers });
  if (!ok(put, 'upload put')) return null;
  const done = http.post(`${ws}/uploads/${u.uploadId}/complete`, JSON.stringify({ title }), { headers: headers(s) });
  return ok(done, 'upload complete') ? done.json().sourceId : null;
}

function waitReady(s, sourceId, pollSeconds) {
  const started = Date.now();
  while (Date.now() - started < 240_000) {
    const r = http.get(`${BASE}/api/workspaces/${s.wid}/sources/${sourceId}`, { headers: headers(s), tags: { name: 'source poll' } });
    if (r.status === 200) {
      const state = r.json('ingestionState');
      if (state === 'READY' || state === 'PARTIAL') return Date.now() - started;
      if (state === 'FAILED' || state === 'QUARANTINED') return -1;
    }
    sleep(pollSeconds);
  }
  return -1;
}

export function setup() {
  const email = `perf+${Date.now()}@example.test`;
  const password = `Perf-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const csrfRes = http.get(`${BASE}/api/auth/csrf`);
  const csrf = cookieOf(csrfRes, 'fv_csrf');
  const reg = http.post(`${BASE}/api/auth/register`, JSON.stringify({ email, password, displayName: 'Perf user' }), {
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, cookie: `fv_csrf=${csrf}` },
  });
  if (reg.status !== 201) fail(`register -> ${reg.status}`);
  const s = { at: cookieOf(reg, 'fv_at'), rt: cookieOf(reg, 'fv_rt'), csrf: cookieOf(reg, 'fv_csrf') || csrf };
  const me = http.get(`${BASE}/api/auth/me`, { headers: headers(s) }).json();
  s.wid = me.workspaces[0].id;
  const projects = http.get(`${BASE}/api/workspaces/${s.wid}/projects`, { headers: headers(s) }).json();
  s.projectId = projects.find((p) => p.kind === 'KNOWLEDGE').id;
  s.sourceId = upload(s, 'Load test brief', DOC);
  if (!s.sourceId || waitReady(s, s.sourceId, 1) < 0) fail('setup document did not become READY');
  return s;
}

export function streamRun(s) {
  const ws = `${BASE}/api/workspaces/${s.wid}`;
  const run = http.post(
    `${ws}/runs`,
    JSON.stringify({ graph: 'grounded_qa', input: { question: 'What annual growth does the base case project through 2030?' }, scope: { sourceIds: [s.sourceId] } }),
    { headers: headers(s), tags: { name: 'run create' } },
  );
  runCreate.add(run.timings.duration);
  if (!ok(run, 'run create')) return;
  const runId = run.json('runId') || run.json('id');
  const res = http.get(`${ws}/runs/${runId}/events`, { headers: headers(s, { accept: 'text/event-stream' }), timeout: '180s', tags: { name: 'run events' } });
  sseFirstByte.add(res.timings.waiting);
  sseStream.add(res.timings.duration);
  const finished = check(res, {
    'stream 200': (r) => r.status === 200,
    'stream ends with run.finished': (r) => String(r.body).includes('"type":"run.finished"'),
  });
  if (!finished) {
    failures.add(1, { step: 'stream' });
    console.error(`stream ${runId} -> ${res.status} ${String(res.body).slice(-300)}`);
  }
}

export function ingest(s) {
  const title = `Load doc ${__VU}`;
  const sourceId = upload(s, title, `${DOC}\nVariant ${__VU}: regional demand rose ${10 + __VU}% in the survey period.\n`);
  if (!sourceId) return;
  const ms = waitReady(s, sourceId, 3);
  if (!check(ms, { 'ingestion READY': (v) => v >= 0 })) {
    failures.add(1, { step: 'ingest' });
    return;
  }
  ingestReady.add(ms);
}

export function handleSummary(data) {
  const pick = (m) => data.metrics[m] && data.metrics[m].values;
  const out = {
    finishedAt: new Date().toISOString(),
    base: BASE,
    vus: { sse: SSE_VUS, ingest: INGEST_VUS },
    metrics: Object.fromEntries(['run_create', 'sse_first_byte', 'sse_stream', 'ingest_ready', 'http_req_failed', 'checks', 'fv_failures'].map((m) => [m, pick(m)])),
    thresholds: Object.fromEntries(Object.entries(data.metrics).filter(([, v]) => v.thresholds).map(([k, v]) => [k, v.thresholds])),
  };
  return { stdout: `${JSON.stringify(out, null, 2)}\n`, [__ENV.FV_SUMMARY || 'perf-summary.json']: JSON.stringify(out, null, 2) };
}
