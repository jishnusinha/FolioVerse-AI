#!/usr/bin/env node
/**
 * Backend vertical-slice smoke test against a running stack (no browser):
 * register -> upload -> ingest (READY) -> grounded_qa run -> SSE stream -> receipt -> insight artifacts
 * -> notes and search -> writer (save, suggestion accept, DNA extract, continuity, export) -> costs.
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
  patch = (p, b, e) => this.req('PATCH', p, b, e);

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

const para = (blockId, text) => ({ type: 'paragraph', attrs: { blockId }, content: [{ type: 'text', text }] });

/** Gate 5: manuscript, autosave with revision check, one suggestion accepted, DNA proposals, continuity, export. */
async function writerSmoke(c, wid, sourceId, step) {
  const ws = `/api/workspaces/${wid}`;
  const m = await c.post(`${ws}/manuscripts`, { title: 'Smoke Manuscript (DEMO)' });
  const ms = `${ws}/manuscripts/${m.id}`;
  const scene = m.nodes.find((n) => n.kind === 'SCENE');
  const docUrl = `${ms}/nodes/${scene.id}/doc`;
  const saved = await c.patch(docUrl, {
    revision: 0,
    content: { type: 'doc', content: [para('s1', 'Mara climbed the lighthouse stairs while the storm bell rang very loudly twice.'), para('s2', 'Mara pushed the wet hair from her face, her blue eyes narrowing at the dark water.')] },
  });
  const conflict = await c.patch(docUrl, { revision: 0, content: { type: 'doc', content: [para('s1', 'Elsewhere.')] } }, { allowError: true });
  step(`writer save: r${saved.revision} words=${saved.wordCount}; stale save -> ${conflict.status} ${conflict.data?.code}`);
  if (conflict.status !== 409) throw new Error('expected a revision conflict');

  const req = await c.post(`${ms}/nodes/${scene.id}/suggestions`, { mode: 'shorten', blockIds: ['s1'] });
  const runId = req.suggestions[0].runId;
  const evs = await c.sse(`${ws}/runs/${runId}/events`);
  if (!evs.some((e) => e.type === 'run.finished')) throw new Error(`suggestion run did not finish: ${JSON.stringify(evs.at(-1))}`);
  const sugg = (await c.get(`${ms}/suggestions?nodeId=${scene.id}`)).find((s) => s.id === req.suggestions[0].id);
  if (!sugg?.variants?.length) throw new Error('suggestion has no variants');
  const doc = await c.get(docUrl);
  const content = structuredClone(doc.content);
  content.content[0].content = [{ type: 'text', text: sugg.variants[0].text }];
  const accepted = await c.patch(docUrl, { revision: doc.revision, content, action: 'accept', suggestionId: sugg.id, variant: 0 });
  step(`suggestion: ${sugg.variants.length} variants, accepted -> r${accepted.revision} origin=${accepted.origin}`);

  const ex = await c.post(`${ms}/dna/extract`, {});
  await c.sse(`${ws}/runs/${ex.runId}/events`);
  const dna = await c.get(`${ms}/dna`);
  const proposed = dna.facts.filter((f) => f.status === 'PROPOSED');
  step(`dna extract: ${proposed.length} proposed facts, ${dna.facts.filter((f) => f.status === 'CANON').length} canon (proposals need approval)`);
  if (dna.facts.some((f) => f.status === 'CANON' && f.origin !== 'AUTHOR')) throw new Error('AI extraction wrote canon directly');

  await c.post(`${ms}/dna/facts`, { subject: 'Mara', predicate: 'eye color', value: 'green' });
  const check = await c.post(`${ms}/continuity/check`, {});
  for (const r of check.runs) await c.sse(`${ws}/runs/${r.runId}/events`);
  const issues = await c.get(`${ms}/continuity`);
  step(`continuity: ${issues.length} issue(s) ${issues.map((i) => `${i.entity}/${i.fact}: ${i.expected} vs ${i.found}`).join('; ')}`);
  if (!issues.some((i) => i.entity === 'Mara' && i.found === 'blue')) throw new Error('continuity check missed the eye colour');

  const ex2 = await c.post(`${ws}/excerpts`, { sourceId, quote: 'Procurement cycles shortened to 90 days' });
  const rn = await c.post(`${ms}/research-notes`, { excerptId: ex2.id, nodeId: scene.id });
  const md = await c.get(`${ms}/export?format=md`);
  const docx = await c.get(`${ms}/export?format=docx`, { raw: true });
  step(`research note "${rn.quote.slice(0, 30)}…"; export md=${md.length} chars, docx=${docx.status} ${docx.headers.get('content-type')}`);
  if (docx.status !== 200 || !md.includes('Smoke Manuscript')) throw new Error('export failed');
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
  step(`receipt: model=${receipt.modelCalls?.at(-1)?.model ?? receipt.modelPlan?.primary?.model} cost=${receipt.cost?.total} ${receipt.cost?.currency} tier=${receipt.cost?.tier} demo=${receipt.cost?.isDemo}`);

  const abst = await c.post(`/api/workspaces/${wid}/runs`, {
    graph: 'grounded_qa',
    input: { question: 'Who painted the ceiling of the Sistine Chapel?' },
    scope: { sourceIds: [done.sourceId] },
  });
  const abEvents = await c.sse(`/api/workspaces/${wid}/runs/${abst.runId ?? abst.id ?? abst.run?.id}/events`);
  const abFinished = abEvents.find((e) => e.type === 'run.finished');
  step(`abstention: outcome=${abFinished?.data.outcome} modelCalls=${abEvents.filter((e) => e.type === 'usage.recorded').length}`);

  const artifacts = [];
  for (const [graph, action] of [
    ['insight', 'quick_summary'],
    ['knowledge_map', 'knowledge_map'],
  ]) {
    const ins = await c.post(`/api/workspaces/${wid}/runs`, { graph, input: { action }, scope: { sourceIds: [done.sourceId] } });
    const insEvents = await c.sse(`/api/workspaces/${wid}/runs/${ins.runId}/events`);
    const fin = insEvents.find((e) => e.type === 'run.finished');
    if (!fin?.data.artifactId) throw new Error(`${action}: no artifact (${JSON.stringify(fin?.data ?? insEvents.at(-1)).slice(0, 200)})`);
    const art = await c.get(`/api/workspaces/${wid}/artifacts/${fin.data.artifactId}`);
    artifacts.push(art);
    if (!art.citations.length) throw new Error(`${action}: artifact has no validated citations`);
    step(`insight ${action}: ${art.kind} "${art.title}" format=${art.format} pins=${art.pins.length} citations=${art.citations.length}`);
  }

  const note = await c.post(`/api/workspaces/${wid}/notes`, { body: 'Check the procurement assumption.', sourceId: done.sourceId, quote: 'Procurement cycles shortened to 90 days' });
  const found = await c.get(`/api/workspaces/${wid}/search?q=procurement`);
  const byType = found.items.reduce((a, it) => ({ ...a, [it.type]: (a[it.type] ?? 0) + 1 }), {});
  step(`search "procurement": ${JSON.stringify(byType)} semantic=${found.semantic.status}`);
  if (!found.items.some((it) => it.type === 'note' && it.id === note.id) || found.semantic.status !== 'OK' || !byType.passage) throw new Error('search check failed');

  await writerSmoke(c, wid, done.sourceId, step);

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
