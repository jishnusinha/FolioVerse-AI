#!/usr/bin/env node
/**
 * Backend vertical-slice smoke test against a running stack (no browser):
 * register -> upload -> ingest (READY) -> grounded_qa run -> SSE stream -> receipt -> costs.
 * Also checks abstention (no model call) and cross-workspace 404.
 * Uses the deterministic mock model unless a live provider is configured. Prints no secrets.
 *
 *   node infrastructure/scripts/smoke.mjs [--base http://localhost:3000]
 */
import { randomBytes } from 'node:crypto';

const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:3000';

export class Client {
  constructor(baseUrl) {
    this.base = baseUrl;
    this.cookies = new Map();
  }
  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  store(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (v) this.cookies.set(k, v);
      else this.cookies.delete(k);
    }
  }
  async req(method, path, body, extra = {}) {
    const headers = { cookie: this.cookieHeader(), ...(extra.headers ?? {}) };
    if (this.cookies.get('fv_csrf')) headers['x-csrf-token'] = this.cookies.get('fv_csrf');
    let payload = body;
    if (body !== undefined && !(body instanceof Uint8Array) && typeof body !== 'string') {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(this.base + path, { method, headers, body: payload, signal: extra.signal });
    this.store(res);
    if (extra.raw) return res;
    const text = await res.text();
    const data = text ? (res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text) : null;
    if (!res.ok && !extra.allowError) throw new Error(`${method} ${path} -> ${res.status} ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    return extra.allowError ? { status: res.status, data } : data;
  }
  get = (p, e) => this.req('GET', p, undefined, e);
  post = (p, b, e) => this.req('POST', p, b ?? {}, e);
  put = (p, b, e) => this.req('PUT', p, b, e);

  /** Reads an SSE stream until a terminal event or timeout. */
  async sse(path, until = (e) => e.type === 'run.finished' || e.type === 'run.failed', timeoutMs = 120_000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await this.req('GET', path, undefined, { raw: true, signal: ctrl.signal, headers: { accept: 'text/event-stream' } });
    if (!res.ok) throw new Error(`SSE ${path} -> ${res.status}`);
    const events = [];
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = block
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('\n');
          if (!data) continue;
          const ev = JSON.parse(data);
          events.push(ev);
          if (until(ev)) {
            ctrl.abort();
            return events;
          }
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) throw e;
    } finally {
      clearTimeout(timer);
    }
    return events;
  }
}

export const DEMO_DOC = `# Market Outlook 2026 (DEMO document)

The outlook projects 14.2% annual growth in its base case through 2030, driven by enterprise adoption.

Procurement cycles shortened to 90 days in 2025 as buyers standardised vendor reviews.

## Risks

Supply chain concentration remains a risk because two vendors provide most accelerator capacity.
Regulatory uncertainty in the European market could delay deployments by several months.

## Scenarios

The upside scenario reaches 19% growth if procurement accelerates further.
The downside scenario assumes 6% growth when budgets tighten.
`;

export async function registerUser(client, label = 'smoke') {
  await client.get('/api/auth/csrf');
  const email = `${label}+${randomBytes(4).toString('hex')}@example.test`;
  const password = `Pw-${randomBytes(12).toString('base64url')}`;
  await client.post('/api/auth/register', { email, password, displayName: `${label} user` });
  const me = await client.get('/api/auth/me');
  return { email, me, workspaceId: me.workspaces[0].id };
}

export async function uploadText(client, wid, projectId, filename, text) {
  const bytes = new TextEncoder().encode(text);
  const up = await client.post(`/api/workspaces/${wid}/uploads`, { projectId, filename, sizeBytes: bytes.length });
  if (up.mode === 'proxy') await client.put(up.url, bytes, { headers: up.headers });
  else {
    const r = await fetch(up.url, { method: 'PUT', headers: up.headers, body: bytes });
    if (!r.ok) throw new Error(`signed PUT -> ${r.status}`);
  }
  return client.post(`/api/workspaces/${wid}/uploads/${up.uploadId}/complete`, { title: filename.replace(/\.\w+$/, '') });
}

export async function waitReady(client, wid, sourceId, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const s = await client.get(`/api/workspaces/${wid}/sources/${sourceId}`);
    if (['READY', 'PARTIAL'].includes(s.ingestionState)) return s;
    if (['FAILED', 'QUARANTINED'].includes(s.ingestionState)) throw new Error(`ingestion ${s.ingestionState}: ${JSON.stringify(s.jobs?.[0]?.error)}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('ingestion timed out');
}

async function main() {
  const step = (m) => console.log(`• ${m}`);
  const c = new Client(base);
  const ready = await c.get('/api/ready', { allowError: true });
  step(`ready: ${ready.status} ${JSON.stringify(ready.data?.checks ?? ready.data)}`);

  const { workspaceId: wid } = await registerUser(c);
  step('registered user with personal workspace');
  const projects = await c.get(`/api/workspaces/${wid}/projects`);
  const knowledge = projects.find((p) => p.kind === 'KNOWLEDGE');

  const done = await uploadText(c, wid, knowledge.id, 'market-outlook-demo.md', DEMO_DOC);
  step(`upload complete: ${done.state}`);
  const src = await waitReady(c, wid, done.sourceId);
  step(`ingestion: ${src.ingestionState} (${src.manifests?.[0]?.childCount ?? '?'} child chunks)`);

  const run = await c.post(`/api/workspaces/${wid}/runs`, {
    graph: 'grounded_qa',
    input: { question: 'What annual growth does the base case project through 2030?' },
    scope: { sourceIds: [done.sourceId] },
  });
  step(`run created: ${run.status ?? run.run?.status} (estimate reserved)`);
  const runId = run.runId ?? run.id ?? run.run?.id;
  const events = await c.sse(`/api/workspaces/${wid}/runs/${runId}/events`);
  const types = events.map((e) => e.type);
  const finished = events.find((e) => e.type === 'run.finished');
  step(`SSE: ${events.length} events, terminal=${types.at(-1)}, tokens=${types.filter((t) => t === 'token.delta').length}`);
  if (!finished) throw new Error(`run did not finish: ${JSON.stringify(events.at(-1))}`);
  step(`answer (${finished.data.outcome}): ${finished.data.answer.slice(0, 160)}`);
  const cites = events.filter((e) => e.type === 'citation.validated').map((e) => e.data.state);
  step(`citations: ${cites.join(', ') || 'none'}`);

  await new Promise((r) => setTimeout(r, 2500));
  const receipt = await c.get(`/api/workspaces/${wid}/runs/${runId}/receipt`);
  step(`receipt: model=${receipt.model?.model ?? receipt.plan?.primary?.model} cost=${receipt.cost?.total} ${receipt.cost?.currency} tier=${receipt.cost?.tier} demo=${receipt.cost?.isDemo}`);

  const abst = await c.post(`/api/workspaces/${wid}/runs`, {
    graph: 'grounded_qa',
    input: { question: 'Who painted the ceiling of the Sistine Chapel?' },
    scope: { sourceIds: [done.sourceId] },
  });
  const abEvents = await c.sse(`/api/workspaces/${wid}/runs/${abst.runId ?? abst.id ?? abst.run?.id}/events`);
  const abFinished = abEvents.find((e) => e.type === 'run.finished');
  step(`abstention: outcome=${abFinished?.data.outcome} modelCalls=${abEvents.filter((e) => e.type === 'usage.recorded').length}`);

  const costs = await c.get(`/api/workspaces/${wid}/costs/summary`);
  step(`costs summary: ${JSON.stringify(costs).slice(0, 200)}`);

  const other = new Client(base);
  const { workspaceId: otherWid } = await registerUser(other, 'other');
  const cross = await other.get(`/api/workspaces/${wid}/sources/${done.sourceId}`, { allowError: true });
  const cross2 = await c.get(`/api/workspaces/${otherWid}/projects`, { allowError: true });
  step(`cross-workspace access: ${cross.status} / ${cross2.status} (expect 404 / 404)`);
  if (cross.status !== 404 || cross2.status !== 404) throw new Error('tenant isolation check failed');
  if (finished.data.outcome !== 'ANSWERED' || abFinished?.data.outcome !== 'ABSTAINED') throw new Error('unexpected outcomes');
  console.log('SMOKE OK');
}

if (process.argv[1]?.endsWith('smoke.mjs')) {
  main().catch((e) => {
    console.error(`SMOKE FAILED: ${e.message}`);
    process.exit(1);
  });
}
