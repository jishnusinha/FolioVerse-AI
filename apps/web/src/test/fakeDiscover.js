/**
 * Fake Discover endpoints (Gate 7): a small synthetic DEMO catalog, a transparent scoring function with the
 * same factor names, weights, prior cap and MMR caps as the real recommender, logged sets, feedback that shelves
 * saved books in the fake Library, rec_explain runs and offline evaluation reports.
 */
const STREAM_BASE = 1_760_000_000_000;
const FACTORS = [
  ['semantic', 'Semantic affinity'],
  ['tfidf', 'TF-IDF similarity'],
  ['theme', 'Theme overlap'],
  ['preference', 'Preference match'],
  ['prior', 'Quality prior (capped)'],
];
const DEFAULT_WEIGHTS = { semantic: 0.35, tfidf: 0.2, theme: 0.2, preference: 0.2, prior: 0.05 };
const PRIOR_CAP = 0.1;

/** [kind, title, creator, year, genres, moods, themes, franchise?] */
const TITLES = [
  ['BOOK', 'The Salt Archive', 'Ilse Marwick', 2017, ['Literary'], ['Melancholic'], ['memory', 'grief', 'the sea']],
  ['FILM', 'The Salt Archive', 'Tomas Reyna', 2021, ['Literary'], ['Melancholic'], ['memory', 'grief', 'the sea'], 'The Salt Archive'],
  ['BOOK', 'Lanterns over Halcyon', 'Anaïs Verhoeven', 2019, ['Sci-fi'], ['Atmospheric'], ['memory', 'isolation', 'space']],
  ['BOOK', 'An Orbit of Quiet Machines', 'Ade Okonjo', 2022, ['Sci-fi'], ['Hopeful'], ['artificial minds', 'kinship', 'space']],
  ['FILM', 'Signal Garden', 'Mara Lindqvist', 2018, ['Sci-fi'], ['Atmospheric'], ['isolation', 'artificial minds', 'ecology']],
  ['FILM', 'Cold Harbour', 'Jon Achterberg', 2015, ['Mystery'], ['Tense'], ['the sea', 'guilt', 'small towns']],
  ['BOOK', 'The Lighthouse Ledger', 'Hedda Lund', 2012, ['Mystery'], ['Tense'], ['the sea', 'secrets', 'small towns']],
  ['BOOK', 'A Cartography of Tides', 'Maren Holt', 2019, ['Literary'], ['Hopeful'], ['the sea', 'family', 'memory']],
  ['FILM', 'Weather for Strangers', 'Ines Calloway', 2020, ['Literary'], ['Hopeful'], ['kinship', 'small towns', 'ecology']],
  ['BOOK', 'The Glass Orchard', 'Priya Nandakumar', 2016, ['Fantasy'], ['Atmospheric'], ['ecology', 'inheritance', 'secrets']],
  ['FILM', 'Night Ferry', 'Tomas Reyna', 2017, ['Thriller'], ['Tense'], ['the sea', 'guilt', 'secrets']],
  ['BOOK', 'Lanterns over Halcyon II', 'Anaïs Verhoeven', 2021, ['Sci-fi'], ['Atmospheric'], ['memory', 'space', 'kinship'], 'The Halcyon Cycle'],
  ['BOOK', 'The Hollow Station', 'Ruth Abara', 2014, ['Sci-fi'], ['Tense'], ['isolation', 'guilt', 'space']],
  ['FILM', 'Paper Moons', 'Mara Lindqvist', 2023, ['Fantasy'], ['Hopeful'], ['childhood', 'memory', 'family']],
  ['BOOK', 'Small Weathers', 'Ines Calloway', 2016, ['Literary'], ['Melancholic'], ['grief', 'ecology', 'family']],
  ['FILM', 'The Archivist', 'Jon Achterberg', 2019, ['Mystery'], ['Atmospheric'], ['secrets', 'memory', 'inheritance']],
  ['BOOK', 'Harbour Lights', 'Hedda Lund', 2018, ['Mystery'], ['Melancholic'], ['small towns', 'grief', 'secrets']],
  ['BOOK', 'What the River Kept', 'Tomasz Wilk', 2011, ['Literary'], ['Melancholic'], ['inheritance', 'family', 'grief']],
  ['FILM', 'Long Light', 'Ruth Abara', 2022, ['Sci-fi'], ['Hopeful'], ['space', 'kinship', 'artificial minds']],
  ['BOOK', 'The Fern Clock', 'Priya Nandakumar', 2020, ['Fantasy'], ['Atmospheric'], ['childhood', 'secrets', 'ecology']],
  ['FILM', 'Undertow', 'Ilse Marwick', 2016, ['Thriller'], ['Tense'], ['the sea', 'guilt', 'family']],
  ['BOOK', 'Second Winter', 'Maren Holt', 2023, ['Literary'], ['Hopeful'], ['kinship', 'grief', 'small towns']],
  ['FILM', 'The Quiet Machines', 'Ade Okonjo', 2024, ['Sci-fi'], ['Atmospheric'], ['artificial minds', 'isolation', 'memory'], 'An Orbit of Quiet Machines'],
  ['BOOK', 'Saltwater Psalms', 'Tomasz Wilk', 2015, ['Literary'], ['Atmospheric'], ['the sea', 'faith', 'memory']],
];

const words = (s) => (s ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const overlap = (a, b) => {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  return a.filter((x) => B.has(x)).length / Math.sqrt(a.length * b.length);
};

export function createFakeDiscover({ db, uuid, iso, ok, problem, library }) {
  const D = { catalog: [], tastes: [], feedback: [], sets: [], interactions: [], evaluations: [], failRecommender: false };
  db.discover = D;
  const me = () => db.user.id;
  TITLES.forEach(([kind, title, creator, year, genres, moods, themes, franchise], i) => {
    D.catalog.push({
      id: uuid(),
      slug: `${kind === 'BOOK' ? 'b' : 'f'}${String(i + 1).padStart(4, '0')}`,
      kind,
      title,
      creators: [creator],
      year,
      genres,
      moods,
      themes,
      description: `A ${moods[0].toLowerCase()} ${genres[0].toLowerCase()} ${kind === 'BOOK' ? 'novel' : 'film'} about ${themes.join(', ')}. Synthetic DEMO title.`,
      franchise: franchise ?? null,
      length: kind === 'BOOK' ? 220 + i * 7 : 90 + i,
      quality: 0.55 + ((i * 37) % 40) / 100,
      popularity: 0.2 + ((i * 53) % 80) / 100,
      coverTone: (i % 6) + 1,
      isDemo: true,
    });
  });
  const byId = (id) => D.catalog.find((c) => c.id === id);
  const fb = (wid, itemId) => D.feedback.find((f) => f.workspaceId === wid && f.userId === me() && f.itemId === itemId);
  const present = (wid, c) => {
    const f = fb(wid, c.id);
    return { ...c, feedback: { saved: f?.saved ?? false, rating: f?.rating ?? null, dismissed: f?.dismissed ?? false, libraryItemId: f?.libraryItemId ?? null } };
  };
  const taste = (wid) => D.tastes.find((t) => t.workspaceId === wid && t.userId === me()) ?? null;

  function effectiveWeights(req) {
    const w = Object.fromEntries(FACTORS.map(([k]) => [k, Math.min(1, Math.max(0, req?.[k] ?? DEFAULT_WEIGHTS[k]))]));
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    if (!sum) return { ...DEFAULT_WEIGHTS };
    for (const k of Object.keys(w)) w[k] /= sum;
    w.prior = Math.min(w.prior, PRIOR_CAP);
    return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4]));
  }

  function recommend(wid, body) {
    if (D.failRecommender) return problem(503, 'The recommender is not available right now', 'RECOMMENDER_UNAVAILABLE');
    const t0 = Date.now();
    const t = taste(wid);
    const mine = D.feedback.filter((f) => f.workspaceId === wid && f.userId === me());
    const positives = [...(t?.seedItemIds ?? []), ...mine.filter((f) => f.saved || f.rating === 1).map((f) => f.itemId)].map(byId).filter(Boolean);
    const negatives = mine.filter((f) => f.rating === -1 || f.dismissed).map((f) => byId(f.itemId));
    const exclude = new Set(mine.filter((f) => f.saved || f.rating !== null || f.dismissed).map((f) => f.itemId));
    const q = words(body.query);
    const userThemes = [...(t?.themes ?? []), ...positives.flatMap((p) => p.themes)];
    const lab = body.lab ?? null;
    const weights = effectiveWeights(lab?.weights);
    const lambda = lab?.lambda ?? 0.7;
    const perCreator = lab?.perCreator ?? 2;
    const cold = !positives.length && !q.length && !(t?.themes?.length || t?.genres?.length || t?.moods?.length);
    const filtered = D.catalog.filter(
      (c) =>
        (!body.kind || c.kind === body.kind) &&
        (!body.genres?.length || c.genres.some((g) => body.genres.includes(g))) &&
        (!body.moods?.length || c.moods.some((m) => body.moods.includes(m))),
    );
    const eligible = filtered.filter((c) => !exclude.has(c.id));
    const scored = eligible.map((c) => {
      const text = words(`${c.title} ${c.description} ${c.themes.join(' ')}`);
      const f = {
        semantic: Math.min(1, overlap(q, text) * 1.6 + overlap(userThemes, c.themes) * 0.5),
        tfidf: Math.min(1, overlap(q, words(`${c.title} ${c.description}`)) * 1.4),
        theme: Math.min(1, overlap(userThemes, c.themes)),
        preference: Math.min(1, ((t?.genres ?? []).some((g) => c.genres.includes(g)) ? 0.6 : 0) + ((t?.moods ?? []).some((m) => c.moods.includes(m)) ? 0.4 : 0)),
        prior: c.quality,
      };
      const penalty = negatives.length ? 0.15 * Math.max(...negatives.map((n) => overlap(n.themes, c.themes))) : 0;
      const score = FACTORS.reduce((a, [k]) => a + weights[k] * f[k], 0) - penalty;
      return { c, f, score, penalty };
    });
    scored.sort((a, b) => b.score - a.score || a.c.slug.localeCompare(b.c.slug));
    scored.forEach((s, i) => (s.baseRank = i + 1));
    const k = Math.min(body.k ?? 12, 24);
    const chosen = [];
    const perC = new Map();
    const perF = new Map();
    let skipped = 0;
    const pool = [...scored];
    while (chosen.length < k && pool.length) {
      let best = -1;
      let bestVal = -Infinity;
      let bestSim = 0;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        const sim = chosen.length ? Math.max(...chosen.map((x) => overlap(x.c.themes, s.c.themes))) : 0;
        const val = lambda * s.score - (1 - lambda) * sim;
        if (val > bestVal) [best, bestVal, bestSim] = [i, val, sim];
      }
      const [s] = pool.splice(best, 1);
      const creator = s.c.creators[0];
      if ((perC.get(creator) ?? 0) >= perCreator || (s.c.franchise && (perF.get(s.c.franchise) ?? 0) >= 2)) {
        skipped += 1;
        continue;
      }
      perC.set(creator, (perC.get(creator) ?? 0) + 1);
      if (s.c.franchise) perF.set(s.c.franchise, (perF.get(s.c.franchise) ?? 0) + 1);
      s.diversity = -(1 - lambda) * bestSim;
      chosen.push(s);
    }
    const setId = uuid();
    const anchor = positives[0];
    const items = chosen.map((s, i) => {
      const shared = s.c.themes.filter((th) => userThemes.includes(th) || q.includes(th)).slice(0, 3);
      const factors = FACTORS.map(([key, label]) => ({ key, label, value: Math.round(s.f[key] * 1e4) / 1e4, weight: weights[key], contribution: Math.round(s.f[key] * weights[key] * 1e4) / 1e4 }));
      const adjustments = [
        ...(s.penalty ? [{ key: 'dislike', label: 'Similar to something you disliked', value: -Math.round(s.penalty * 1e4) / 1e4 }] : []),
        ...(s.diversity ? [{ key: 'diversity', label: 'Diversity (MMR)', value: Math.round(s.diversity * 1e4) / 1e4 }] : []),
      ];
      const becauseOf = anchor && anchor.id !== s.c.id && overlap(anchor.themes, s.c.themes) > 0.3 ? { kind: 'item', id: anchor.id, title: anchor.title } : null;
      const rationale = cold
        ? `A well-rated ${s.c.genres[0].toLowerCase()} ${s.c.kind === 'BOOK' ? 'book' : 'film'} to start with.`
        : shared.length
          ? `Shares the ${shared.slice(0, 2).join(' and ')} theme${shared.length > 1 ? 's' : ''}${becauseOf ? ` of ${becauseOf.title}` : ''}.`
          : `A close match for your taste in ${s.c.genres[0].toLowerCase()}.`;
      return { itemId: s.c.id, rank: i + 1, baseRank: s.baseRank, score: Math.round(s.score * 1e4) / 1e4, factors, adjustments, sharedThemes: shared, becauseOf, rationale };
    });
    const mode = lab ? 'LAB' : 'DISCOVER';
    const set = {
      id: setId,
      workspaceId: wid,
      userId: me(),
      mode,
      query: body.query?.trim() || null,
      filters: { kind: body.kind ?? null, genres: body.genres ?? [], moods: body.moods ?? [] },
      weights,
      lambda,
      k,
      modelVersion: 'recsys-hybrid v1',
      stages: {
        candidates: cold ? { prior: eligible.length, unique: eligible.length } : { semantic: Math.min(120, eligible.length), tfidf: Math.min(80, eligible.length), theme: Math.min(64, eligible.length), collaborative: positives.length ? Math.min(40, eligible.length) : 0, unique: eligible.length },
        eligible: filtered.length,
        excluded: filtered.length - eligible.length,
        scored: scored.length,
        diversity: { lambda, perCreator, perFranchise: 2, mediaCap: body.kind ? null : Math.ceil(0.6 * k), skippedByCaps: skipped },
        final: items.length,
      },
      profile: { positives: positives.length, negatives: negatives.length, query: body.query ?? '', context: 0, topThemes: [...new Set(userThemes)].slice(0, 5) },
      coldStart: cold,
      latencyMs: Math.max(1, Date.now() - t0),
      createdAt: iso(),
      items,
    };
    D.sets.push(set);
    if (mode === 'DISCOVER') for (const it of items) D.interactions.push({ id: uuid(), workspaceId: wid, userId: me(), itemId: it.itemId, kind: 'IMPRESSION', setId, position: it.rank });
    return ok(view(wid, set), 201);
  }

  const view = (wid, set) => ({ ...set, items: set.items.map((r) => ({ ...r, item: present(wid, byId(r.itemId)) })) });
  const ownSet = (wid, id) => D.sets.find((s) => s.id === id && s.workspaceId === wid && s.userId === me());

  function feedback(wid, body) {
    const c = byId(body.itemId);
    if (!c) return problem(404, 'Title not found');
    if (body.action !== 'CLEAR_RATING') D.interactions.push({ id: uuid(), workspaceId: wid, userId: me(), itemId: c.id, kind: body.action, setId: body.setId ?? null, position: body.position ?? null });
    if (body.action === 'CLICK') return ok(present(wid, c), 201);
    let f = fb(wid, c.id);
    if (!f) {
      f = { id: uuid(), workspaceId: wid, userId: me(), itemId: c.id, saved: false, rating: null, dismissed: false, reason: null, libraryItemId: null };
      D.feedback.push(f);
    }
    const patch = {
      SAVE: { saved: true, dismissed: false },
      UNSAVE: { saved: false },
      LIKE: { rating: 1, dismissed: false },
      DISLIKE: { rating: -1, saved: false },
      CLEAR_RATING: { rating: null },
      DISMISS: { dismissed: true, saved: false, reason: body.reason ?? null },
      UNDISMISS: { dismissed: false, reason: null },
    }[body.action];
    if (!patch) return problem(400, 'Unknown action', 'VALIDATION');
    Object.assign(f, patch);
    if (body.action === 'SAVE' && c.kind === 'BOOK') {
      const L = db.library;
      const known = f.libraryItemId && L.items.find((i) => i.id === f.libraryItemId);
      if (!known) {
        const book = library.addBook(wid, { title: c.title, authors: c.creators, publishedYear: c.year, description: c.description, subjects: c.themes, pageCount: c.length, externalIds: { catalogId: c.id } });
        f.libraryItemId = library.addItem(wid, book, { status: 'TO_READ' }).id;
      }
    }
    return ok(present(wid, c), 201);
  }

  function explainScript(run, rec, c) {
    const ev = [];
    let seq = 0;
    const at = new Date(run.createdAt).getTime();
    const push = (type, data) => {
      seq += 1;
      ev.push({ id: `${STREAM_BASE + seq}-0`, schemaVersion: 1, type, seq, ts: new Date(at + seq * 40).toISOString(), runId: run.id, data });
    };
    const top = [...rec.factors].sort((a, b) => b.contribution - a.contribution).slice(0, 2);
    const answer = `“${c.title}” ranked here mostly on ${top.map((f) => f.label.toLowerCase()).join(' and ')}. ${rec.sharedThemes.length ? `It shares ${rec.sharedThemes.join(', ')} with what you like. ` : ''}Expect a ${c.moods[0].toLowerCase()} ${c.genres[0].toLowerCase()} ${c.kind === 'BOOK' ? 'book' : 'film'}.`;
    push('run.state', { status: 'RUNNING' });
    push('node.started', { node: 'explain', step: 1 });
    push('run.state', { status: 'STREAMING' });
    for (const piece of answer.match(/.{1,24}(\s|$)|.+/g)) push('token.delta', { text: piece });
    push('node.finished', { node: 'explain', step: 1, status: 'SUCCEEDED', durationMs: 220 });
    push('usage.recorded', { provider: 'mock', model: 'mock-grounded', modelConfigId: 'mock-grounded', attempt: 1, status: 'SUCCEEDED', reported: true, usage: { inputTokens: 420, outputTokens: 50 }, isDemo: true });
    push('run.finished', { status: 'SUCCEEDED', outcome: 'ANSWERED', answer });
    return { events: ev, outcome: 'ANSWERED', answer, citations: [], calls: 1 };
  }

  function explain(wid, setId, itemId) {
    const set = ownSet(wid, setId);
    const rec = set?.items.find((r) => r.itemId === itemId);
    if (!rec) return problem(404, 'Recommendation not found');
    const c = byId(itemId);
    const run = {
      id: uuid(),
      workspaceId: wid,
      threadId: null,
      messageId: null,
      graph: 'rec_explain',
      tier: 'T0',
      status: 'QUEUED',
      outcome: null,
      isDemo: true,
      lab: false,
      input: { text: `Why was “${c.title}” recommended?`, params: { setId, itemId, factors: rec.factors, sharedThemes: rec.sharedThemes } },
      scope: { sourceVersionIds: [] },
      modelPlan: { primary: { modelConfigId: 'mock-grounded', provider: 'mock', model: 'mock-grounded' }, fallbacks: [], isDemo: true },
      error: null,
      result: null,
      parentRunId: null,
      createdAt: iso(),
      startedAt: null,
      finishedAt: null,
    };
    db.ai.runs.push(run);
    db.ai.script.set(run.id, explainScript(run, rec, c));
    D.interactions.push({ id: uuid(), workspaceId: wid, userId: me(), itemId, kind: 'EXPLAIN', setId, position: rec.rank });
    return ok({ runId: run.id, threadId: null, messageId: null, status: 'QUEUED', estimate: '0.00008000', model: run.modelPlan.primary }, 201);
  }

  const REPORT = {
    name: 'rec-offline-eval',
    modelVersion: 'recsys-hybrid v1',
    k: 10,
    users: 300,
    catalogItems: 530,
    isDemo: true,
    note: 'Synthetic catalog and synthetic users (DEMO). Metrics show relative behaviour of the variants, not real-world quality.',
    metrics: { precision: 'Precision@K', recall: 'Recall@K', ndcg: 'nDCG@K', hitRate: 'Hit rate@K', coverage: 'Catalog coverage', diversity: 'Intra-list diversity (1 − cosine)', novelty: 'Novelty (mean self-information, bits)', popularityPercentile: 'Popularity bias (mean popularity percentile; 0.5 = none)' },
    variants: [
      { name: 'popularity', label: 'Most popular (baseline)', precision: 0.0193, recall: 0.0427, ndcg: 0.0324, hitRate: 0.18, coverage: 0.0302, diversity: 0.888, novelty: 3.531, popularityPercentile: 0.9902 },
      { name: 'item_knn', label: 'Item-kNN collaborative filtering', precision: 0.038, recall: 0.0889, ndcg: 0.0677, hitRate: 0.33, coverage: 0.8472, diversity: 0.8357, novelty: 4.46, popularityPercentile: 0.6836 },
      { name: 'nmf', label: 'NMF collaborative filtering', precision: 0.034, recall: 0.0737, ndcg: 0.0522, hitRate: 0.2967, coverage: 0.7226, diversity: 0.8428, novelty: 4.367, popularityPercentile: 0.7297 },
      { name: 'content', label: 'Content only (semantic + TF-IDF + themes)', precision: 0.061, recall: 0.146, ndcg: 0.1044, hitRate: 0.4867, coverage: 0.9415, diversity: 0.6758, novelty: 4.805, popularityPercentile: 0.5347 },
      { name: 'hybrid', label: 'Hybrid, no diversification', precision: 0.0587, recall: 0.1395, ndcg: 0.1035, hitRate: 0.4467, coverage: 0.8981, diversity: 0.7015, novelty: 4.611, popularityPercentile: 0.618 },
      { name: 'hybrid_mmr', label: 'Hybrid + MMR (served)', precision: 0.0497, recall: 0.1158, ndcg: 0.0894, hitRate: 0.4, coverage: 0.9132, diversity: 0.7611, novelty: 4.627, popularityPercentile: 0.6151 },
    ],
    durationMs: 6145,
  };

  /** Each list request moves a pending report one step (QUEUED → RUNNING → SUCCEEDED), like the worker would. */
  function advanceEvaluations(wid) {
    for (const r of D.evaluations.filter((x) => x.workspaceId === wid)) {
      if (r.status === 'RUNNING') Object.assign(r, { status: 'SUCCEEDED', report: { ...REPORT, k: r.k, createdAt: iso() }, modelVersion: REPORT.modelVersion, finishedAt: iso() });
      else if (r.status === 'QUEUED') Object.assign(r, { status: 'RUNNING', startedAt: iso() });
    }
  }

  function vocabulary() {
    const count = new Map();
    for (const c of D.catalog) for (const th of c.themes) count.set(th, (count.get(th) ?? 0) + 1);
    return {
      genres: [...new Set(D.catalog.flatMap((c) => c.genres))].sort(),
      moods: [...new Set(D.catalog.flatMap((c) => c.moods))].sort(),
      themes: [...count].map(([name, n]) => ({ name, count: n })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** @returns {{ status: number, headers: Record<string,string>, body: any } | undefined} undefined when not a discover route */
  function handle(method, wid, rest, body, need, query) {
    if (rest[0] !== 'discover') return undefined;
    const [, a, id, sub, subId, action] = rest;
    if (a === 'taste' && method === 'GET') {
      const seeds = [...D.catalog].sort((x, y) => y.popularity - x.popularity).slice(0, 24);
      return ok({ profile: taste(wid), catalogSize: D.catalog.length, vocabulary: vocabulary(), seeds: seeds.map((s) => present(wid, s)) });
    }
    if (a === 'taste' && method === 'PUT') {
      let t = taste(wid);
      const data = { genres: body.genres ?? [], moods: body.moods ?? [], themes: body.themes ?? [], seedItemIds: (body.seedItemIds ?? []).filter(byId), onboardedAt: iso() };
      if (t) Object.assign(t, data);
      else D.tastes.push((t = { id: uuid(), workspaceId: wid, userId: me(), ...data }));
      return ok(t);
    }
    if (a === 'catalog' && !id && method === 'GET') {
      const kind = query.get('kind');
      const rows = D.catalog.filter((c) => !kind || c.kind === kind);
      return ok({ total: rows.length, items: rows.slice(0, Number(query.get('limit') ?? 24)).map((c) => present(wid, c)) });
    }
    if (a === 'catalog' && id && !sub && method === 'GET') {
      const c = byId(id);
      return c ? ok(present(wid, c)) : problem(404, 'Title not found');
    }
    if (a === 'catalog' && id && sub === 'similar' && method === 'GET') {
      const c = byId(id);
      if (!c) return problem(404, 'Title not found');
      if (D.failRecommender) return problem(503, 'The recommender is not available right now', 'RECOMMENDER_UNAVAILABLE');
      const other = query.get('otherKind') === 'true';
      const rows = D.catalog
        .filter((x) => x.id !== c.id && (!other || x.kind !== c.kind))
        .map((x) => ({ x, sim: overlap(c.themes, x.themes) }))
        .filter((r) => r.sim > 0)
        .sort((p, q) => q.sim - p.sim)
        .slice(0, 6);
      return ok(rows.map((r) => ({ similarity: Math.round(r.sim * 1e4) / 1e4, sharedThemes: c.themes.filter((t) => r.x.themes.includes(t)), item: present(wid, r.x) })));
    }
    if (a === 'recommendations' && !id && method === 'POST') return recommend(wid, body ?? {});
    if (a === 'recommendations' && id === 'latest' && method === 'GET') {
      const mode = query.get('mode') === 'LAB' ? 'LAB' : 'DISCOVER';
      const s = D.sets.filter((x) => x.workspaceId === wid && x.userId === me() && x.mode === mode).at(-1);
      return ok(s ? view(wid, s) : { id: null, items: [] });
    }
    if (a === 'recommendations' && id && !sub && method === 'GET') {
      const s = ownSet(wid, id);
      return s ? ok(view(wid, s)) : problem(404, 'Recommendation set not found');
    }
    if (a === 'recommendations' && sub === 'items' && action === 'explain' && method === 'POST') return need('EDITOR') ?? explain(wid, id, subId);
    if (a === 'feedback' && method === 'POST') return feedback(wid, body ?? {});
    if (a === 'saved' && method === 'GET') {
      return ok(D.feedback.filter((f) => f.workspaceId === wid && f.userId === me() && f.saved).map((f) => present(wid, byId(f.itemId))));
    }
    if (a === 'model' && method === 'GET') {
      if (D.failRecommender) return problem(503, 'The recommender is not available right now', 'RECOMMENDER_UNAVAILABLE');
      return ok({
        name: 'rec_model',
        version: 1,
        label: 'recsys-hybrid v1',
        createdAt: iso(600),
        isDemo: true,
        algorithm: 'TF-IDF + LSA embeddings + theme overlap + NMF implicit CF (NNLS fold-in); MMR diversification',
        data: { catalogSha256: '10ce46b5…', interactionsSha256: '46ceb659…' },
        params: { lsaDims: 64, cfFactors: 24, seed: 0 },
        training: { items: 530, users: 300, interactions: 5454 },
        vocabulary: 2108,
        files: [{ path: 'rec_model_v1.npz', sha256: '4f1e0c9b8a7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f', bytes: 2_400_000 }],
      });
    }
    if (a === 'evaluations' && !id && method === 'POST') {
      const denied = need('EDITOR');
      if (denied) return denied;
      const r = { id: uuid(), workspaceId: wid, requestedById: me(), status: 'QUEUED', k: body?.k ?? 10, modelVersion: null, report: null, error: null, createdAt: iso(), startedAt: null, finishedAt: null };
      D.evaluations.unshift(r);
      return ok(r, 201);
    }
    if (a === 'evaluations' && !id && method === 'GET') {
      advanceEvaluations(wid);
      return ok(D.evaluations.filter((r) => r.workspaceId === wid).slice(0, 10));
    }
    if (a === 'evaluations' && id && method === 'GET') {
      const r = D.evaluations.find((x) => x.id === id && x.workspaceId === wid);
      return r ? ok(r) : problem(404, 'Evaluation not found');
    }
    return problem(404, 'Not found');
  }

  return { discover: D, handle, catalog: D.catalog };
}
