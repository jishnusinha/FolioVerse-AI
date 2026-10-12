/**
 * AI half of the in-memory fake API: runs, run events (SSE), threads, receipts, traces, budget and costs.
 * Answers are scripted from the question text; no model is called and every amount is DEMO.
 * A run's events are served by `GET runs/:id/events`; the run and its message complete when the final
 * event has been served, as with the real worker.
 */

/** Page text of the synthetic Atlas brief (`datasets/synthetic/docs/atlas-brief.pdf`). */
export const ATLAS_PAGES = [
  [
    'Project Atlas Brief',
    'Summary',
    'This brief is a fictional DEMO document prepared for FolioVerse tests.',
    'Under the base scenario, the market for assisted research tools grows at a compound',
    'annual rate of 14.2% between 2026 and 2030.',
    'Regulated industries lead demand because they must document how conclusions were reached.',
    'Upside scenario',
    'The upside case reaches 19% annual growth if enterprise procurement shortens',
    'to under six months.',
    'Analysts describe the upside case as plausible but not probable.',
  ],
  [
    'Risks',
    'Pricing pressure',
    'Bundled office suites are the main pricing risk for standalone research tools.',
    'Vendors that rely on per-seat pricing face the strongest discount pressure.',
    'Procurement',
    'Growth above 12% per year is unlikely while procurement cycles exceed nine months.',
    'Data-residency reviews add roughly eight weeks to public-sector deals.',
  ],
  [
    'Method and regions',
    'Survey',
    'The survey covered 412 organisations across three regions in the spring of 2026.',
    'Responses were weighted by organisation size and sector.',
    'Regional outlook',
    'EMEA adoption trails North America by about two years.',
    'APAC shows the fastest growth among mid-sized firms, led by logistics companies.',
  ],
].map((lines, i) => ({ pageNo: i + 1, text: lines.join('\n') }));

/**
 * Scripted answers: question pattern → page, quote and answer text. Bboxes are PDF points with a top-left
 * origin, derived from the generator layout (A4 height 842, first body line baseline at 718, 16pt leading).
 */
const FACTS = [
  {
    match: /survey|organi[sz]ations|respond/i,
    page: 3,
    quote: 'The survey covered 412 organisations across three regions in the spring of 2026.',
    bbox: [72, 115, 472, 127],
    answer: 'The survey covered 412 organisations across three regions [S1].',
  },
  {
    match: /risk|pricing|bundle/i,
    page: 2,
    quote: 'Bundled office suites are the main pricing risk for standalone research tools.',
    bbox: [72, 115, 462, 127],
    answer: 'The main pricing risk is bundled office suites [S1].',
  },
  {
    match: /./,
    page: 1,
    quote: 'annual rate of 14.2% between 2026 and 2030.',
    bbox: [72, 147, 292, 159],
    answer: 'In the base scenario the market grows at a compound annual rate of 14.2% between 2026 and 2030 [S1].',
  },
];
const ABSTAIN = /antarctica|weather|unanswerable/i;
const INTERRUPT = /worker crash/i;

const MODEL = {
  id: 'mock-grounded',
  provider: 'mock',
  model: 'mock-grounded',
  displayName: 'Mock grounded model',
  status: 'ACTIVE',
  contextWindow: 32000,
  maxOutputTokens: 800,
  isDemo: true,
  isDefault: true,
  available: true,
  price: { inputPerMTok: '0.40', outputPerMTok: '1.60', cachedInputPerMTok: null, isDemo: true, sourceUrl: null },
};
const usd = (n) => n.toFixed(8);
const costOf = (input, output) => (input * Number(MODEL.price.inputPerMTok) + output * Number(MODEL.price.outputPerMTok)) / 1e6;
const STREAM_BASE = 1_760_000_000_000;
const TERMINAL = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'BUDGET_REJECTED']);

/**
 * @param {{ db: any, uuid: () => string, iso: (minutesAgo?: number) => string, ok: Function, problem: Function, noContent: Function,
 *   opts: { empty?: boolean, budgetLimit?: string, budgetHard?: boolean, streamCut?: number, pdfBytes?: Uint8Array } }} deps
 */
export function createFakeAi({ db, uuid, iso, ok, problem, noContent, opts }) {
  const ai = {
    threads: [],
    messages: [],
    runs: [],
    /** runId → full scripted event list (token deltas included) */
    script: new Map(),
    /** runId → number of event requests served */
    served: new Map(),
    nodes: [],
    costEntries: [],
    budget: { limit: opts.budgetLimit ?? '5.00', hard: opts.budgetHard ?? false },
    /** Serve only this many events on a run's first event request, to exercise Last-Event-ID resume. */
    streamCut: opts.streamCut ?? 0,
  };
  db.ai = ai;

  const spent = (wid) => ai.costEntries.filter((e) => e.workspaceId === wid && e.entryType === 'FINAL').reduce((a, e) => a + Number(e.amount), 0);
  function budgetStatus(wid) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const s = spent(wid);
    return {
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      limit: ai.budget.limit,
      spent: usd(s),
      reserved: '0',
      remaining: usd(Number(ai.budget.limit) - s),
      hard: ai.budget.hard,
      currency: 'USD',
    };
  }

  function scriptFor(run, question, svid) {
    const ev = [];
    let seq = 0;
    const at = new Date(run.createdAt).getTime();
    const push = (type, data) => {
      seq += 1;
      ev.push({ id: `${STREAM_BASE + seq}-0`, schemaVersion: 1, type, seq, ts: new Date(at + seq * 40).toISOString(), runId: run.id, data });
    };
    push('run.state', { status: 'RUNNING' });
    push('node.started', { node: 'retrieve', step: 1 });
    if (INTERRUPT.test(question)) {
      // What the reaper publishes after the worker holding the run stops heartbeating.
      push('run.state', { status: 'INTERRUPTED' });
      return { events: ev, status: 'INTERRUPTED', outcome: null, answer: '', citations: [], calls: 0 };
    }
    if (ABSTAIN.test(question)) {
      push('retrieval.completed', { candidates: 6, packed: 0, topScore: 0.12, contextTokens: 0, abstain: true, sources: [] });
      push('node.finished', { node: 'retrieve', step: 1, status: 'SUCCEEDED', durationMs: 38 });
      push('node.started', { node: 'abstain', step: 2 });
      push('node.finished', { node: 'abstain', step: 2, status: 'SUCCEEDED', durationMs: 1 });
      push('node.started', { node: 'finalize', step: 3 });
      push('node.finished', { node: 'finalize', step: 3, status: 'SUCCEEDED', durationMs: 1 });
      const answer = 'I could not find evidence for this in the selected document, so I did not answer.';
      push('run.finished', { status: 'SUCCEEDED', outcome: 'ABSTAINED', answer });
      return { events: ev, outcome: 'ABSTAINED', answer, citations: [], calls: 0 };
    }
    const fact = FACTS.find((f) => f.match.test(question));
    const pageText = ATLAS_PAGES[fact.page - 1].text;
    const start = pageText.indexOf(fact.quote);
    const chunkId = uuid();
    push('retrieval.completed', {
      candidates: 8,
      packed: 3,
      topScore: 0.82,
      contextTokens: 640,
      abstain: false,
      sources: [{ marker: 'S1', chunkId, sourceVersionId: svid, page: fact.page, score: 0.82 }],
    });
    push('node.finished', { node: 'retrieve', step: 1, status: 'SUCCEEDED', durationMs: 42 });
    push('node.started', { node: 'generate', step: 2 });
    push('run.state', { status: 'STREAMING' });
    for (const piece of fact.answer.match(/.{1,18}(\s|$)|.+/g)) push('token.delta', { text: piece });
    push('node.finished', { node: 'generate', step: 2, status: 'SUCCEEDED', durationMs: 610 });
    push('node.started', { node: 'validate_citations', step: 3 });
    const citation = {
      marker: 'S1',
      state: 'VALID',
      score: 1,
      quote: fact.quote,
      anchor: {
        sourceVersionId: svid,
        chunkId,
        state: 'EXACT',
        selectors: {
          page: fact.page,
          textQuote: { exact: fact.quote, prefix: pageText.slice(Math.max(0, start - 32), start), suffix: pageText.slice(start + fact.quote.length, start + fact.quote.length + 32) },
          textPosition: { start, end: start + fact.quote.length },
          bbox: fact.bbox,
        },
      },
    };
    push('citation.validated', citation);
    push('node.finished', { node: 'validate_citations', step: 3, status: 'SUCCEEDED', durationMs: 4 });
    push('usage.recorded', {
      provider: MODEL.provider,
      model: MODEL.model,
      modelConfigId: MODEL.id,
      attempt: 1,
      status: 'SUCCEEDED',
      reported: true,
      usage: { inputTokens: 1200, outputTokens: 80 },
      isDemo: true,
    });
    push('node.started', { node: 'finalize', step: 4 });
    push('node.finished', { node: 'finalize', step: 4, status: 'SUCCEEDED', durationMs: 1 });
    push('run.finished', { status: 'SUCCEEDED', outcome: 'ANSWERED', answer: fact.answer });
    return { events: ev, outcome: 'ANSWERED', answer: fact.answer, citations: [{ ...citation, sourceVersionId: svid, chunkId }], calls: 1 };
  }

  /** Applies a run's recorded outcome: run status, message, node executions and the FINAL cost entry. */
  function complete(run) {
    if (TERMINAL.has(run.status)) return;
    const s = ai.script.get(run.id);
    const startedAt = new Date(run.createdAt).getTime();
    run.status = s.status ?? 'SUCCEEDED';
    run.outcome = s.outcome;
    run.startedAt = new Date(startedAt + 40).toISOString();
    run.finishedAt = new Date(startedAt + 40 * s.events.length).toISOString();
    run.result = { answer: s.answer };
    const msg = ai.messages.find((m) => m.id === run.messageId);
    if (msg) {
      msg.status = run.status === 'INTERRUPTED' ? 'FAILED' : s.outcome === 'ABSTAINED' ? 'ABSTAINED' : 'COMPLETE';
      msg.content = s.answer;
      msg.citations = s.citations.map((c) => ({ id: uuid(), workspaceId: run.workspaceId, messageId: msg.id, ...c }));
    }
    const started = new Map();
    for (const e of s.events) {
      if (e.type === 'node.started') started.set(e.data.node, e.ts);
      if (e.type === 'node.finished') {
        ai.nodes.push({ id: uuid(), runId: run.id, node: e.data.node, step: e.data.step, status: e.data.status, startedAt: started.get(e.data.node), finishedAt: e.ts, durationMs: e.data.durationMs, summary: null });
      }
    }
    if (s.calls) {
      ai.costEntries.push({
        id: uuid(),
        workspaceId: run.workspaceId,
        runId: run.id,
        modelConfigId: MODEL.id,
        entryType: 'FINAL',
        tier: 'FINALIZED',
        costClass: 'MODEL',
        amount: usd(costOf(1200, 80)),
        currency: 'USD',
        feature: run.graph,
        isDemo: true,
        createdAt: run.finishedAt,
      });
    }
  }

  function createRun(wid, body, createdAt = iso()) {
    const question = (body.input?.question ?? '').trim();
    if (!question) return problem(400, 'A question is required', 'VALIDATION');
    const svids = (body.scope?.sourceVersionIds ?? []).filter((id) => {
      const v = db.versions.find((x) => x.id === id && x.workspaceId === wid);
      const s = v && db.sources.find((x) => x.id === v.sourceId);
      return v && s && !s.deletedAt && ['READY', 'PARTIAL'].includes(v.ingestionState);
    });
    if (!svids.length) return problem(400, 'No ready sources in scope. Wait for ingestion to finish or pick other sources.', 'EMPTY_SCOPE');

    let thread = body.threadId ? ai.threads.find((t) => t.id === body.threadId && t.workspaceId === wid) : null;
    if (body.threadId && !thread) return problem(404, 'Thread not found');
    if (!thread) {
      const owner = db.sources.find((s) => s.id === db.versions.find((v) => v.id === svids[0]).sourceId);
      thread = { id: uuid(), workspaceId: wid, projectId: owner.projectId, sourceId: owner.id, title: question.slice(0, 80), archivedAt: null, createdAt, updatedAt: createdAt };
      ai.threads.push(thread);
    }
    thread.updatedAt = createdAt;
    const inThread = ai.messages.filter((m) => m.threadId === thread.id);
    const parent = body.parentMessageId ?? inThread.at(-1)?.id ?? null;
    const userMessage = { id: uuid(), workspaceId: wid, threadId: thread.id, parentMessageId: parent, role: 'USER', content: question, status: 'COMPLETE', aiRunId: null, createdAt, citations: [] };
    ai.messages.push(userMessage);

    const estimate = costOf(Math.ceil(question.length / 4) + 3500, MODEL.maxOutputTokens);
    const run = {
      id: uuid(),
      workspaceId: wid,
      threadId: thread.id,
      messageId: null,
      graph: body.graph,
      tier: 'T1',
      status: 'QUEUED',
      outcome: null,
      isDemo: true,
      lab: false,
      input: body.input,
      scope: { sourceVersionIds: svids },
      modelPlan: { primary: { modelConfigId: MODEL.id, provider: MODEL.provider, model: MODEL.model }, fallbacks: [], maxOutputTokens: MODEL.maxOutputTokens, isDemo: true },
      error: null,
      result: null,
      parentRunId: null,
      createdAt,
      startedAt: null,
      finishedAt: null,
    };
    ai.runs.push(run);
    const remaining = Number(budgetStatus(wid).remaining);
    if (ai.budget.hard && estimate > remaining) {
      Object.assign(run, { status: 'BUDGET_REJECTED', finishedAt: createdAt, error: { code: 'BUDGET', message: 'Budget limit reached before any model call', estimate: usd(estimate), remaining: usd(remaining) } });
      return ok({ runId: run.id, threadId: thread.id, userMessageId: userMessage.id, messageId: null, status: 'BUDGET_REJECTED', estimate: usd(estimate), remaining: usd(remaining) }, 201);
    }
    ai.costEntries.push({ id: uuid(), workspaceId: wid, runId: run.id, modelConfigId: MODEL.id, entryType: 'ESTIMATE', tier: 'PREFLIGHT_ESTIMATE', costClass: 'MODEL', amount: usd(estimate), currency: 'USD', feature: body.graph, isDemo: true, createdAt });
    const assistant = { id: uuid(), workspaceId: wid, threadId: thread.id, parentMessageId: userMessage.id, role: 'ASSISTANT', content: '', status: 'STREAMING', aiRunId: run.id, createdAt, citations: [] };
    ai.messages.push(assistant);
    run.messageId = assistant.id;
    ai.script.set(run.id, scriptFor(run, question, svids[0]));
    return ok({ runId: run.id, threadId: thread.id, userMessageId: userMessage.id, messageId: assistant.id, status: 'QUEUED', estimate: usd(estimate), model: run.modelPlan.primary }, 201);
  }

  function sse(events) {
    return {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      body: `retry: 2000\n\n${events.map((e) => `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')}`,
    };
  }

  function receipt(run) {
    const s = ai.script.get(run.id);
    const entries = ai.costEntries.filter((e) => e.runId === run.id);
    const finals = entries.filter((e) => e.entryType === 'FINAL');
    const estimate = entries.find((e) => e.entryType === 'ESTIMATE');
    const done = TERMINAL.has(run.status);
    const tier = finals.length || (done && !s?.calls) ? 'FINALIZED' : estimate ? 'PREFLIGHT_ESTIMATE' : 'FINALIZED';
    const calls = done && s?.calls ? [{ id: uuid(), provider: MODEL.provider, model: MODEL.model, status: 'SUCCEEDED', attempt: 1 }] : [];
    const cites = done ? (s?.citations ?? []) : [];
    return {
      run: { ...run, durationMs: run.startedAt && run.finishedAt ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime() : null },
      modelPlan: run.modelPlan,
      modelCalls: calls,
      tokens: calls.length ? { input: 1200, output: 80, cachedInput: 0, reasoning: 0 } : { input: 0, output: 0, cachedInput: 0, reasoning: 0 },
      cost: { total: usd(finals.reduce((a, e) => a + Number(e.amount), 0)), estimate: estimate?.amount ?? null, tier, currency: 'USD', isDemo: true, entries },
      retrieval: [],
      citations: { total: cites.length, byState: cites.reduce((a, c) => ({ ...a, [c.state]: (a[c.state] ?? 0) + 1 }), {}) },
      nodes: ai.nodes.filter((n) => n.runId === run.id).map(({ node, step, status, durationMs }) => ({ node, step, status, durationMs })),
      traceUrl: `/app/studio/runs/${run.id}`,
    };
  }

  function summary(wid, days) {
    const since = Date.now() - days * 86400_000;
    const finals = ai.costEntries.filter((e) => e.workspaceId === wid && e.entryType === 'FINAL' && new Date(e.createdAt).getTime() >= since);
    const group = (key) => {
      const m = new Map();
      for (const e of finals) m.set(key(e), (m.get(key(e)) ?? 0) + Number(e.amount));
      return [...m.entries()].map(([k, v]) => ({ key: k, amount: usd(v) }));
    };
    const daily = Array.from({ length: days }, (_, i) => new Date(Date.now() - (days - 1 - i) * 86400_000).toISOString().slice(0, 10)).map((date) => ({
      date,
      amount: usd(finals.filter((e) => e.createdAt.slice(0, 10) === date).reduce((a, e) => a + Number(e.amount), 0)),
    }));
    return {
      days,
      currency: 'USD',
      total: usd(finals.reduce((a, e) => a + Number(e.amount), 0)),
      isDemo: finals.length > 0,
      byTier: group((e) => e.tier),
      byModel: group((e) => e.modelConfigId),
      byFeature: group((e) => e.feature),
      byClass: group((e) => e.costClass),
      daily,
      tokens: { input: finals.length * 1200, output: finals.length * 80, cachedInput: 0, reasoning: 0, calls: finals.length },
      budget: budgetStatus(wid),
    };
  }

  const GRAPH = {
    name: 'grounded_qa',
    tier: 'T1',
    description: 'Retrieve evidence, abstain or answer, validate citations.',
    nodes: ['__start__', 'retrieve', 'abstain', 'budget_stop', 'generate', 'validate_citations', 'finalize', '__end__'].map((id) => ({
      id,
      label: id,
      kind: id.startsWith('__') ? 'terminal' : 'node',
    })),
    edges: [
      { source: '__start__', target: 'retrieve', conditional: false },
      { source: 'retrieve', target: 'abstain', conditional: true },
      { source: 'retrieve', target: 'budget_stop', conditional: true },
      { source: 'retrieve', target: 'generate', conditional: true },
      { source: 'budget_stop', target: 'finalize', conditional: false },
      { source: 'generate', target: 'validate_citations', conditional: false },
      { source: 'validate_citations', target: 'finalize', conditional: false },
      { source: 'abstain', target: 'finalize', conditional: false },
      { source: 'finalize', target: '__end__', conditional: false },
    ],
  };

  /** Seeds one finished conversation so Home, Studio and Costs have something to show. */
  function seed(wid, source) {
    if (!source) return;
    const { hard } = ai.budget;
    ai.budget.hard = false;
    const res = createRun(wid, { graph: 'grounded_qa', input: { question: 'What is the base-case growth rate?' }, scope: { sourceVersionIds: [source.currentVersionId] } }, iso(90));
    const run = ai.runs.find((r) => r.id === res.body.runId);
    complete(run);
    ai.served.set(run.id, 1);
    ai.budget.hard = hard;
  }

  /**
   * @returns {{ status: number, headers: Record<string,string>, body: any } | undefined} undefined when the path is not an AI route
   */
  function handle(method, wid, rest, body, headers, need, query) {
    const r = rest.join('/');
    if (r === 'events' && method === 'GET') return noContent();
    if (r === 'budget' && method === 'GET') return ok(budgetStatus(wid));
    if (r === 'costs/summary' && method === 'GET') return ok(summary(wid, Math.min(Math.max(Number(query.get('days')) || 30, 1), 365)));
    if (r === 'costs/entries' && method === 'GET') {
      const rows = ai.costEntries.filter((e) => e.workspaceId === wid).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return ok(rows.slice(0, Number(query.get('limit')) || 100));
    }
    if (rest[0] === 'graphs' && method === 'GET') return rest[1] === GRAPH.name ? ok(GRAPH) : problem(404, 'Unknown graph');
    if (rest[0] === 'sources' && rest[2] === 'versions' && rest[4] === 'pages' && method === 'GET') {
      const v = db.versions.find((x) => x.id === rest[3] && x.sourceId === rest[1] && x.workspaceId === wid);
      if (!v) return problem(404, 'Not found');
      return ok(['READY', 'PARTIAL'].includes(v.ingestionState) ? ATLAS_PAGES.map((p) => ({ id: `${v.id}-${p.pageNo}`, sourceVersionId: v.id, ...p })) : []);
    }

    if (rest[0] === 'threads') {
      if (rest.length === 1 && method === 'GET') {
        const sid = query.get('sourceId');
        const rows = ai.threads.filter((t) => t.workspaceId === wid && !t.archivedAt && (!sid || t.sourceId === sid)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return ok(rows.map((t) => ({ ...t, messageCount: ai.messages.filter((m) => m.threadId === t.id).length })));
      }
      const t = ai.threads.find((x) => x.id === rest[1] && x.workspaceId === wid);
      if (!t) return problem(404, 'Not found');
      if (method === 'GET') return ok({ ...t, scope: null, messages: ai.messages.filter((m) => m.threadId === t.id) });
    }

    if (r === 'runs' && method === 'POST') return need('EDITOR') ?? createRun(wid, body);
    if (r === 'runs' && method === 'GET') {
      const rows = ai.runs.filter((x) => x.workspaceId === wid).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return ok(rows.slice(0, Math.min(Number(query.get('limit')) || 50, 200)));
    }
    if (rest[0] === 'runs' && rest[1]) {
      const run = ai.runs.find((x) => x.id === rest[1] && x.workspaceId === wid);
      if (!run) return problem(404, 'Not found');
      const s = ai.script.get(run.id);
      if (rest.length === 2 && method === 'GET') return ok(run);
      if (rest[2] === 'receipt' && method === 'GET') return ok(receipt(run));
      if (rest[2] === 'trace' && method === 'GET') {
        const events = TERMINAL.has(run.status) && s ? s.events.filter((e) => e.type !== 'token.delta').map(({ seq, type, data, ts }) => ({ seq, type, data, ts })) : [];
        return ok({ run, events, nodes: ai.nodes.filter((n) => n.runId === run.id), retrieval: [], modelCalls: receipt(run).modelCalls });
      }
      if (rest[2] === 'cancel' && method === 'POST') return need('EDITOR') ?? ok({ status: run.status }, 202);
      if (rest[2] === 'events' && method === 'GET') {
        if (!s) {
          return sse([{ id: 'p-final', schemaVersion: 1, type: 'run.finished', seq: 1, ts: run.finishedAt ?? iso(), runId: run.id, data: { status: run.status, outcome: run.outcome ?? 'PARTIAL', answer: '', error: run.error } }]);
        }
        const last = headers['last-event-id'];
        const after = last ? s.events.filter((e) => Number(e.id.split('-')[0]) > Number(last.split('-')[0])) : s.events;
        const count = (ai.served.get(run.id) ?? 0) + 1;
        ai.served.set(run.id, count);
        const out = count === 1 && ai.streamCut > 0 ? after.slice(0, ai.streamCut) : after;
        if (out.some((e) => e.type === 'run.finished' || (e.type === 'run.state' && TERMINAL.has(e.data.status)))) complete(run);
        return sse(out);
      }
    }
    return undefined;
  }

  return { ai, handle, seed, model: MODEL };
}
