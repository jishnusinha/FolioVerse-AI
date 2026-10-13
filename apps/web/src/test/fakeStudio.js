/**
 * AI Studio half of the in-memory fake API: capabilities, run comparison, Model Battle and RAG evaluations.
 * Contestant and evaluation runs are created through the fake AI runs and completed at once; every amount is DEMO.
 */

const FAULTS = [
  { id: 'provider_timeout', label: 'Provider timeout', effect: 'The first model call times out; a fallback model is tried if the plan has one.' },
  { id: 'provider_429', label: 'Rate limit (429)', effect: 'The first model call is rate limited. Same fallback rule as a timeout.' },
  { id: 'malformed_output', label: 'Malformed output', effect: 'The model returns an unknown citation marker; the run ends PARTIAL.' },
  { id: 'retrieval_down', label: 'Vector store down', effect: 'Retrieval fails before any model call; the run fails and costs nothing.' },
];
const QUESTIONS = [
  { id: 'q1', question: 'What is the base-case growth rate?', answerable: true },
  { id: 'q2', question: 'How many organisations did the survey cover?', answerable: true },
  { id: 'q3', question: 'What is the main pricing risk?', answerable: true },
  { id: 'q4', question: 'What is the weather in Antarctica?', answerable: false },
];
const DOC = 'Market Outlook 2026.pdf';
const TERMINAL = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'BUDGET_REJECTED']);
const LABELS = ['A', 'B', 'C', 'D'];

export function createFakeStudio({ db, uuid, iso, ok, problem, ai: fakeAi, opts }) {
  const studio = { battles: [], evaluations: [] };
  const runOf = (wid, id) => fakeAi.ai.runs.find((r) => r.id === id && r.workspaceId === wid);

  /** Creates a detached lab run and completes it as the worker would. */
  function runNow(wid, body) {
    const res = fakeAi.createRun(wid, { ...body, lab: true, detached: true });
    if (res.status !== 201) return { error: res };
    const run = fakeAi.ai.runs.find((r) => r.id === res.body.runId);
    fakeAi.complete(run);
    fakeAi.ai.served.set(run.id, 1);
    return { run };
  }

  function snapshot(wid, id) {
    const run = runOf(wid, id);
    if (!run) return null;
    const r = fakeAi.receipt(run);
    const s = fakeAi.ai.script.get(run.id);
    const msg = fakeAi.ai.messages.find((m) => m.id === run.messageId);
    return {
      run: { id: run.id, graph: run.graph, status: run.status, outcome: run.outcome, lab: run.lab, isDemo: run.isDemo, parentRunId: run.parentRunId, createdAt: run.createdAt, question: run.input?.question ?? null, options: run.options ?? {} },
      model: { planned: run.modelPlan.primary, used: r.modelCalls.at(-1) ?? null, attempts: r.modelCalls.length },
      answer: msg?.content ?? run.result?.answer ?? '',
      citations: (TERMINAL.has(run.status) ? (s?.citations ?? []) : []).map((c) => ({ marker: c.marker, state: c.state, page: c.anchor?.selectors?.page ?? null })),
      cost: r.cost,
      tokens: r.tokens,
      durationMs: r.run.durationMs,
      retrieval: s?.retrieval
        ? { params: s.retrieval.params, candidates: s.retrieval.candidates.length, latencyMs: s.retrieval.latencyMs, packed: s.retrieval.packed.map(({ marker, page, level, tokens, sourceVersionId }) => ({ marker, page, level, tokens, sourceVersionId })) }
        : null,
    };
  }

  function battleView(wid, b) {
    const revealed = Boolean(b.winner);
    const contestants = b.contestants.map((c) => {
      const run = runOf(wid, c.runId);
      const done = TERMINAL.has(run.status);
      const base = {
        label: c.label,
        status: run.status,
        outcome: run.outcome,
        answer: done ? (run.result?.answer ?? '') : '',
        error: done ? (run.error?.message ?? null) : null,
        citations: done ? (run.result?.citations ?? []).map(({ marker, state }) => ({ marker, state })) : [],
      };
      if (!revealed) return base;
      const r = fakeAi.receipt(run);
      const m = fakeAi.models.find((x) => x.id === c.modelConfigId);
      return { ...base, runId: c.runId, model: { id: m.id, displayName: m.displayName, isDemo: m.isDemo }, cost: r.cost, tokens: r.tokens, durationMs: r.run.durationMs };
    });
    return { id: b.id, question: b.question, sourceRunId: b.sourceRunId, createdAt: b.createdAt, context: b.context, finished: contestants.every((c) => TERMINAL.has(c.status)), revealed, winner: b.winner, votedAt: b.votedAt, contestants };
  }

  function evaluate(wid, e) {
    const items = [];
    for (const q of QUESTIONS) {
      const { run } = runNow(wid, { graph: 'grounded_qa', input: { question: q.question }, scope: { sourceVersionIds: e.scope.sourceVersionIds }, modelPreference: e.modelConfigId, options: { ...e.options, evaluationId: e.id } });
      const abstained = run.outcome === 'ABSTAINED';
      const cites = run.result?.citations ?? [];
      const cost = Number(fakeAi.receipt(run).cost.total);
      items.push({
        id: q.id,
        question: q.question,
        answerable: q.answerable,
        runId: run.id,
        status: run.status,
        outcome: run.outcome,
        abstained,
        abstainCorrect: abstained === !q.answerable,
        retrievalHit: q.answerable ? !abstained : null,
        evidenceFound: q.answerable ? !abstained : null,
        citations: { total: cites.length, valid: cites.filter((c) => c.state === 'VALID').length, weak: 0, unresolved: 0 },
        relevance: e.judge && !abstained ? 4 : null,
        cost,
        latencyMs: 1200,
      });
    }
    const answerable = items.filter((i) => i.answerable);
    const total = items.reduce((a, i) => a + i.cost, 0);
    const ratio = (n, d) => (d ? Math.round((n / d) * 10_000) / 10_000 : null);
    Object.assign(e, {
      status: 'SUCCEEDED',
      items,
      runIds: items.map((i) => i.runId),
      finishedAt: iso(),
      metrics: {
        items: items.length,
        completed: items.length,
        failed: 0,
        faithfulness: ratio(
          items.reduce((a, i) => a + i.citations.valid, 0),
          items.reduce((a, i) => a + i.citations.total, 0),
        ),
        retrievalRecall: ratio(answerable.filter((i) => i.retrievalHit).length, answerable.length),
        answerAccuracy: ratio(answerable.filter((i) => i.evidenceFound).length, answerable.length),
        abstentionAccuracy: ratio(items.filter((i) => i.abstainCorrect).length, items.length),
        answerRelevance: e.judge ? 4 : null,
        costTotal: total.toFixed(8),
        costPerAnswer: (total / items.length).toFixed(8),
        latencyP50Ms: 1200,
      },
    });
  }

  const evalView = (e, withItems = true) => {
    const { items, runIds, scope: _scope, workspaceId: _w, ...rest } = e;
    return { ...rest, progress: { done: items.length, total: QUESTIONS.length }, ...(withItems ? { items, runIds } : {}) };
  };

  function handle(method, wid, rest, body, need, query) {
    if (rest[0] !== 'studio') return undefined;
    const r = rest.slice(1).join('/');
    if (r === 'capabilities' && method === 'GET') {
      return ok({
        labFaults: opts.labFaults !== false,
        faults: FAULTS,
        models: fakeAi.models.map(({ id, displayName, provider, isDemo, isDefault }) => ({ id, displayName, provider, isDemo, isDefault })),
        judge: { liveModel: false },
        datasets: [{ id: 'qa-small', label: 'Market outlook Q&A (DEMO, 4 questions)', doc: DOC, items: QUESTIONS.length, answerable: 3 }],
        notebooks: [
          {
            name: '03-hybrid-retrieval-rrf',
            createdAt: '2026-10-12T10:00:00+00:00',
            smoke: false,
            findings: ['RRF k=60 scores 0.320; the whole k range moves nDCG by 0.041, so the constant is not critical.'],
          },
        ],
      });
    }
    if (r === 'compare' && method === 'GET') {
      const ids = [...new Set((query.get('runs') ?? '').split(',').filter(Boolean))];
      if (ids.length < 2 || ids.length > 4) return problem(400, 'Pick two to four runs to compare', 'COMPARE_COUNT');
      const runs = ids.map((id) => snapshot(wid, id));
      return runs.some((x) => !x) ? problem(404, 'Not found') : ok({ runs });
    }

    if (r === 'battles' && method === 'GET') {
      return ok(
        studio.battles
          .filter((b) => b.workspaceId === wid)
          .map((b) => ({ id: b.id, question: b.question, createdAt: b.createdAt, contestants: b.contestants.length, winner: b.winner, winnerModel: b.winner ? (b.contestants.find((c) => c.label === b.winner)?.modelConfigId ?? null) : null })),
      );
    }
    if (r === 'battles' && method === 'POST') {
      const denied = need('EDITOR');
      if (denied) return denied;
      const src = runOf(wid, body?.runId);
      if (!src) return problem(404, 'Not found');
      if (src.graph !== 'grounded_qa') return problem(400, 'A battle starts from a grounded Q&A run', 'NOT_QA_RUN');
      const models = [...new Set(body.models ?? [])];
      if (models.length < 2 || models.length > 4) return problem(400, 'Pick two to four different models', 'BATTLE_MODELS');
      const s = fakeAi.ai.script.get(src.id);
      if (!s?.retrieval?.packed?.length) return problem(400, 'This run retrieved no passages to freeze', 'NO_CONTEXT');
      const id = uuid();
      const context = s.retrieval.packed.map(({ marker, page, level }) => ({ marker, page, level }));
      const contestants = models.map((modelConfigId, i) => {
        const { run } = runNow(wid, { graph: 'grounded_qa', input: { question: src.input.question }, scope: { sourceVersionIds: src.scope.sourceVersionIds }, modelPreference: modelConfigId, parentRunId: src.id, options: { battleId: id } });
        return { label: LABELS[i], runId: run.id, modelConfigId };
      });
      const b = { id, workspaceId: wid, question: src.input.question, sourceRunId: src.id, createdAt: iso(), context, contestants, winner: null, votedAt: null };
      studio.battles.unshift(b);
      return ok(battleView(wid, b), 201);
    }
    if (rest[1] === 'battles' && rest[2]) {
      const b = studio.battles.find((x) => x.id === rest[2] && x.workspaceId === wid);
      if (!b) return problem(404, 'Not found');
      if (rest.length === 3 && method === 'GET') return ok(battleView(wid, b));
      if (rest[3] === 'vote' && method === 'POST') {
        const denied = need('EDITOR');
        if (denied) return denied;
        if (b.winner) return problem(409, 'This battle already has a vote', 'ALREADY_VOTED');
        if (![...b.contestants.map((c) => c.label), 'TIE'].includes(body?.winner)) return problem(400, 'Vote for one of the answers or a tie', 'INVALID_WINNER');
        Object.assign(b, { winner: body.winner, votedAt: iso() });
        return ok(battleView(wid, b));
      }
    }

    if (r === 'evaluations' && method === 'GET') return ok(studio.evaluations.filter((e) => e.workspaceId === wid).map((e) => evalView(e, false)));
    if (r === 'evaluations' && method === 'POST') {
      const denied = need('EDITOR');
      if (denied) return denied;
      if (body?.dataset !== 'qa-small') return problem(400, 'Unknown evaluation dataset', 'UNKNOWN_DATASET');
      const sources = db.sources.filter((s) => s.workspaceId === wid && !s.deletedAt && s.projectId === body.scope?.projectId && ['READY', 'PARTIAL'].includes(s.ingestionState));
      if (!sources.some((s) => s.title === DOC)) return problem(400, `This dataset asks about ${DOC}. Include that document in the scope.`, 'EVAL_DOC_MISSING');
      const e = {
        id: uuid(),
        workspaceId: wid,
        status: 'QUEUED',
        dataset: 'qa-small',
        modelConfigId: body.modelPreference ?? fakeAi.model.id,
        options: body.options ?? {},
        judge: Boolean(body.judge),
        isDemo: true,
        metrics: null,
        error: null,
        createdAt: iso(),
        startedAt: iso(),
        finishedAt: null,
        items: [],
        runIds: [],
        scope: { sourceVersionIds: sources.map((s) => s.currentVersionId) },
      };
      studio.evaluations.unshift(e);
      evaluate(wid, e);
      return ok(evalView(e), 201);
    }
    if (rest[1] === 'evaluations' && rest[2] && method === 'GET') {
      const e = studio.evaluations.find((x) => x.id === rest[2] && x.workspaceId === wid);
      return e ? ok(evalView(e)) : problem(404, 'Not found');
    }
    return problem(404, 'Not found');
  }

  return { studio, handle };
}
