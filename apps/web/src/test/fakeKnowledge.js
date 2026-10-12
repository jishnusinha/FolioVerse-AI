/**
 * Knowledge half of the in-memory fake API: insight actions, artifacts, notes, search and version diffs.
 * Insight results are scripted DEMO content grounded in the synthetic Atlas brief; no model is called.
 */

/** Mirrors packages/contracts/fixtures/insight-actions.json (checked by fakeKnowledge.test.js). */
export const FAKE_INSIGHT_ACTIONS = [
  ['quick_summary', 'Quick Summary', 'insight', 'T0', 'SUMMARY', 'Summaries', 1],
  ['executive_summary', 'Executive Summary', 'insight', 'T0', 'SUMMARY', 'Summaries', 1],
  ['detailed_breakdown', 'Detailed Breakdown', 'insight', 'T0', 'SUMMARY', 'Summaries', 1],
  ['explain_simply', 'Explain Simply', 'insight', 'T0', 'SUMMARY', 'Summaries', 1],
  ['key_facts', 'Extract Key Facts', 'insight', 'T0', 'KEY_FACTS', 'Summaries', 1],
  ['risks', 'Identify Risks', 'risk_contradiction', 'T1', 'RISK_REPORT', 'Analysis', 1],
  ['contradictions', 'Find Contradictions', 'risk_contradiction', 'T1', 'RISK_REPORT', 'Analysis', 1],
  ['quiz', 'Generate Questions', 'insight', 'T1', 'QUIZ', 'Study', 1],
  ['study_notes', 'Create Study Notes', 'insight', 'T1', 'STUDY_NOTES', 'Study', 1],
  ['flashcards', 'Generate Flashcards', 'insight', 'T1', 'FLASHCARDS', 'Study', 1],
  ['compare', 'Compare with Another Document', 'multi_doc_compare', 'T1', 'COMPARISON', 'Analysis', 2],
  ['extract_tasks', 'Extract Tasks', 'insight', 'T0', 'TASKS', 'Analysis', 1],
  ['research_report', 'Generate Research Report', 'insight', 'T1', 'REPORT', 'Reports', 1],
  ['knowledge_map', 'Create Knowledge Map', 'knowledge_map', 'T1', 'KNOWLEDGE_MAP', 'Reports', 1],
].map(([id, label, graph, tier, kind, group, minSources]) => ({ id, label, graph, tier, kind, group, minSources }));

const ACTION_BY_ID = new Map(FAKE_INSIGHT_ACTIONS.map((a) => [a.id, a]));

/** The registry's rule for a run request: an explicit action must belong to the graph; otherwise the graph's first action. */
export function actionFor(graph, requested) {
  if (requested) {
    const a = ACTION_BY_ID.get(requested);
    return a && a.graph === graph ? a : null;
  }
  return FAKE_INSIGHT_ACTIONS.find((a) => a.graph === graph) ?? null;
}

/** Passages the scripted artifacts cite; bboxes match the Atlas brief layout used by fakeAi.js. */
const PASSAGES = {
  S1: { page: 1, quote: 'annual rate of 14.2% between 2026 and 2030.', bbox: [72, 147, 292, 159] },
  S2: { page: 2, quote: 'Bundled office suites are the main pricing risk for standalone research tools.', bbox: [72, 115, 462, 127] },
};

/** Scripted artifact for an action: `{ format, content, text }` where `text` is what streams as tokens. */
export function scriptedArtifact(action) {
  const md = (markdown) => ({ format: 'markdown', content: { markdown }, text: markdown });
  const json = (content) => ({ format: 'json', content, text: '' });
  switch (action.id) {
    case 'flashcards':
      return json({
        items: [
          { front: 'Base-case annual growth, 2026–2030', back: '14.2% a year [S1].' },
          { front: 'Main pricing risk for standalone tools', back: 'Bundled office suites [S2].' },
        ],
      });
    case 'quiz':
      return json({
        items: [
          { question: 'What annual growth rate does the base scenario assume?', options: ['9%', '14.2%', '19%'], answer: 1, explanation: 'The brief states 14.2% a year [S1].' },
          { question: 'What is the main pricing risk?', options: ['Bundled office suites', 'Currency swings'], answer: 0, explanation: 'Bundled suites put pressure on standalone tools [S2].' },
        ],
      });
    case 'knowledge_map':
      return json({
        nodes: [
          { id: 'market', label: 'Research tools market', marker: 'S1' },
          { id: 'growth', label: '14.2% annual growth', marker: 'S1' },
          { id: 'pricing', label: 'Pricing pressure', marker: 'S2' },
          { id: 'suites', label: 'Bundled office suites', marker: 'S2' },
        ],
        edges: [
          { source: 'market', target: 'growth', label: 'grows at', weight: 2 },
          { source: 'market', target: 'pricing', label: 'faces', weight: 1 },
          { source: 'pricing', target: 'suites', label: 'driven by', weight: 2 },
        ],
      });
    case 'extract_tasks':
      return md('## Tasks\n- [ ] Re-check the 14.2% base-case growth assumption [S1]\n- [ ] Review per-seat pricing against bundled office suites [S2]');
    case 'compare':
      return md('## Comparison\n- Both documents expect the market to grow; the brief gives 14.2% a year [S1].\n- Only one names bundled office suites as the main pricing risk [S2].');
    case 'risks':
    case 'contradictions':
      return md(`## ${action.label}\n- **Pricing:** bundled office suites are the main pricing risk [S2].\n- **Forecast:** the base case depends on 14.2% annual growth [S1].`);
    default:
      return md(`## ${action.label}\n- In the base scenario the market grows 14.2% a year between 2026 and 2030 [S1].\n- Bundled office suites are the main pricing risk for standalone research tools [S2].`);
  }
}

/** `citation.validated` payloads for the scripted markers, spread over the run's scope. */
export function scriptedCitations(svids, pageText, uuid) {
  return Object.entries(PASSAGES).map(([marker, p], i) => {
    const text = pageText(p.page);
    const start = text.indexOf(p.quote);
    return {
      marker,
      state: 'VALID',
      score: 1,
      quote: p.quote,
      sourceVersionId: svids[i] ?? svids[0],
      chunkId: uuid(),
      anchor: {
        sourceVersionId: svids[i] ?? svids[0],
        state: 'EXACT',
        selectors: { page: p.page, textQuote: { exact: p.quote }, textPosition: { start, end: start + p.quote.length }, bbox: p.bbox },
      },
    };
  });
}

const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * @param {{ db: any, uuid: () => string, iso: (minutesAgo?: number) => string, ok: Function, problem: Function, noContent: Function,
 *   pages: (versionId: string) => { pageNo: number, text: string }[] }} deps
 */
export function createFakeKnowledge({ db, uuid, iso, ok, problem, noContent, pages }) {
  const k = { artifacts: [], notes: [] };
  db.knowledge = k;

  const versionsOf = (sourceId) => db.versions.filter((v) => v.sourceId === sourceId).map((v) => v.id);
  const pins = (a) =>
    a.sourceVersionIds.map((svid) => {
      const v = db.versions.find((x) => x.id === svid);
      const s = db.sources.find((x) => x.id === v?.sourceId);
      return {
        sourceVersionId: svid,
        sourceId: v?.sourceId ?? null,
        projectId: s?.projectId ?? null,
        title: s?.title ?? 'Deleted document',
        versionNo: v?.versionNo ?? null,
        current: s?.currentVersionId === svid,
        currentVersionId: s && !s.deletedAt ? s.currentVersionId : null,
      };
    });

  /** Saves the artifact of a finished insight run (idempotent per run), as the executor does. */
  function recordFromRun(run, artifactId, scripted) {
    if (k.artifacts.some((a) => a.runId === run.id)) return;
    const action = ACTION_BY_ID.get(run.input.action);
    const sources = [...new Set(run.scope.sourceVersionIds.map((svid) => db.versions.find((v) => v.id === svid)?.sourceId))].map((id) => db.sources.find((s) => s.id === id));
    const about = sources.length === 1 ? sources[0].title.replace(/\.\w+$/, '') : `${sources.length} documents`;
    k.artifacts.push({
      id: artifactId,
      workspaceId: run.workspaceId,
      projectId: sources[0]?.projectId ?? null,
      sourceId: sources.length === 1 ? sources[0].id : null,
      runId: run.id,
      kind: action.kind,
      action: action.id,
      title: `${action.label} · ${about}`,
      format: scripted.format,
      content: scripted.content,
      sourceVersionIds: run.scope.sourceVersionIds,
      stale: false,
      fallback: false,
      isDemo: true,
      archivedAt: null,
      createdAt: run.finishedAt ?? iso(),
      updatedAt: run.finishedAt ?? iso(),
    });
  }

  /** Marks artifacts built on older versions of a source as stale (new version uploaded). */
  function markStale(sourceId, currentVersionId) {
    const older = new Set(versionsOf(sourceId).filter((id) => id !== currentVersionId));
    for (const a of k.artifacts) if (a.sourceVersionIds.some((id) => older.has(id))) a.stale = true;
  }

  function search(wid, q, projectId, semantic, threads) {
    const term = q.trim().slice(0, 200);
    if (term.length < 2) return { query: term, items: [], semantic: { status: 'SKIPPED' } };
    const needle = term.toLowerCase();
    const words = needle.split(/\W+/).filter((w) => w.length >= 3);
    const hit = (text) => text.toLowerCase().includes(needle) || (words.length > 0 && words.every((w) => text.toLowerCase().includes(w)));
    const inProject = (pid) => !projectId || pid === projectId;
    const live = db.sources.filter((s) => s.workspaceId === wid && !s.deletedAt && inProject(s.projectId));
    const items = [
      ...db.projects.filter((p) => p.workspaceId === wid && !p.deletedAt && hit(p.name)).map((p) => ({ type: 'project', id: p.id, title: p.name, projectId: p.id, score: 1 })),
      ...live.filter((s) => hit(s.title)).map((s) => ({ type: 'source', id: s.id, title: s.title, projectId: s.projectId, sourceId: s.id, score: 0.9 })),
      ...threads
        .filter((t) => t.workspaceId === wid && !t.archivedAt && inProject(t.projectId) && hit(t.title))
        .map((t) => ({ type: 'thread', id: t.id, title: t.title, projectId: t.projectId, sourceId: t.sourceId, score: 0.6 })),
      ...k.artifacts
        .filter((a) => a.workspaceId === wid && !a.archivedAt && inProject(a.projectId) && hit(a.title))
        .map((a) => ({ type: 'artifact', id: a.id, title: a.title, kind: a.kind, projectId: a.projectId, sourceId: a.sourceId, score: 0.7 })),
      ...k.notes
        .filter((n) => n.workspaceId === wid && inProject(n.projectId) && hit(`${n.quote ?? ''} ${n.body}`))
        .map((n) => ({ type: 'note', id: n.id, title: n.body.slice(0, 80), snippet: n.quote ?? undefined, projectId: n.projectId, sourceId: n.sourceId, sourceVersionId: n.sourceVersionId, score: 0.5 })),
    ];
    let status = 'SKIPPED';
    if (semantic !== 'false' && term.length >= 3) {
      status = 'OK';
      for (const s of live) {
        const v = db.versions.find((x) => x.id === s.currentVersionId);
        if (!v || !['READY', 'PARTIAL'].includes(v.ingestionState)) continue;
        for (const p of pages(v.id)) {
          for (const line of p.text.split('\n')) {
            const lw = line.toLowerCase();
            const overlap = words.filter((w) => lw.includes(w)).length;
            if (overlap && overlap >= Math.min(2, words.length)) {
              items.push({ type: 'passage', id: `${v.id}-${p.pageNo}-${items.length}`, title: s.title, snippet: line, projectId: s.projectId, sourceId: s.id, sourceVersionId: v.id, page: p.pageNo, score: overlap / words.length });
            }
          }
        }
      }
    }
    return { query: term, items, semantic: { status, latencyMs: status === 'OK' ? 42 : undefined } };
  }

  function diff(wid, s, toId, againstId) {
    const all = db.versions.filter((v) => v.sourceId === s.id).sort((a, b) => a.versionNo - b.versionNo);
    const to = all.find((v) => v.id === toId);
    if (!to) return problem(404, 'Not found');
    const from = againstId ? all.find((v) => v.id === againstId) : all.filter((v) => v.versionNo < to.versionNo).at(-1);
    if (!from) return ok({ from: null, to: { id: to.id, versionNo: to.versionNo }, summary: null });
    const paras = (vid) => pages(vid).flatMap((p) => p.text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean).map((text, index) => ({ page: p.pageNo, index, text })));
    const a = paras(from.id);
    const b = paras(to.id);
    if (!a.length || !b.length) return ok({ from: { id: from.id, versionNo: from.versionNo }, to: { id: to.id, versionNo: to.versionNo }, summary: null });
    const before = new Set(a.map((p) => norm(p.text)));
    const after = new Set(b.map((p) => norm(p.text)));
    const added = b.filter((p) => !before.has(norm(p.text)));
    const removed = a.filter((p) => !after.has(norm(p.text)));
    return ok({
      from: { id: from.id, versionNo: from.versionNo },
      to: { id: to.id, versionNo: to.versionNo },
      summary: { added: added.length, removed: removed.length, changed: 0, unchanged: b.length - added.length, samples: { added: added.slice(0, 5), removed: removed.slice(0, 5), changed: [] } },
    });
  }

  /** @returns {{ status: number, headers: Record<string,string>, body: any } | undefined} */
  function handle(method, wid, rest, body, need, query, { citationsForRun, threads }) {
    const r = rest.join('/');
    if (r === 'search' && method === 'GET') return ok(search(wid, query.get('q') ?? '', query.get('projectId'), query.get('semantic'), threads));

    if (rest[0] === 'sources' && rest[2] === 'versions' && rest[4] === 'diff' && method === 'GET') {
      const s = db.sources.find((x) => x.id === rest[1] && x.workspaceId === wid);
      if (!s) return problem(404, 'Not found');
      return diff(wid, s, rest[3], query.get('against'));
    }

    if (r === 'artifacts' && method === 'GET') {
      const sid = query.get('sourceId');
      const svids = sid ? new Set(versionsOf(sid)) : null;
      const rows = k.artifacts.filter(
        (a) =>
          a.workspaceId === wid &&
          (query.get('archived') === 'true' ? a.archivedAt : !a.archivedAt) &&
          (!query.get('projectId') || a.projectId === query.get('projectId')) &&
          (!query.get('kind') || a.kind === query.get('kind')) &&
          (!query.get('q') || a.title.toLowerCase().includes(query.get('q').toLowerCase())) &&
          (!svids || a.sourceId === sid || a.sourceVersionIds.some((id) => svids.has(id))),
      );
      return ok(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ content: _content, ...a }) => a));
    }
    if (rest[0] === 'artifacts' && rest[1]) {
      const a = k.artifacts.find((x) => x.id === rest[1] && x.workspaceId === wid);
      if (!a) return problem(404, 'Not found');
      if (method === 'GET') return ok({ ...a, pins: pins(a), citations: citationsForRun(a.runId) });
      const denied = need('EDITOR');
      if (denied) return denied;
      if (method === 'PATCH') {
        if (body.title !== undefined) a.title = body.title;
        if (body.archived !== undefined) a.archivedAt = body.archived ? iso() : null;
        a.updatedAt = iso();
        return ok(a);
      }
      if (method === 'DELETE') {
        k.artifacts.splice(k.artifacts.indexOf(a), 1);
        return noContent();
      }
    }

    if (r === 'notes' && method === 'GET') {
      const rows = k.notes.filter((n) => n.workspaceId === wid && (!query.get('sourceId') || n.sourceId === query.get('sourceId')) && (!query.get('projectId') || n.projectId === query.get('projectId')));
      return ok(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    if (r === 'notes' && method === 'POST') {
      const denied = need('EDITOR');
      if (denied) return denied;
      if (!body?.body?.trim()) return problem(400, 'body should not be empty', 'VALIDATION');
      const s = body.sourceId ? db.sources.find((x) => x.id === body.sourceId && x.workspaceId === wid && !x.deletedAt) : null;
      if (body.sourceId && !s) return problem(404, 'Not found');
      if (body.sourceVersionId && !db.versions.some((v) => v.id === body.sourceVersionId && v.sourceId === s?.id)) return problem(400, 'Version does not belong to the source', 'VALIDATION');
      const note = {
        id: uuid(),
        workspaceId: wid,
        projectId: s?.projectId ?? body.projectId ?? null,
        sourceId: s?.id ?? null,
        sourceVersionId: body.sourceVersionId ?? null,
        body: body.body,
        quote: body.quote ?? null,
        anchor: body.anchor ?? null,
        createdAt: iso(),
        updatedAt: iso(),
      };
      k.notes.push(note);
      return ok(note, 201);
    }
    if (rest[0] === 'notes' && rest[1]) {
      const n = k.notes.find((x) => x.id === rest[1] && x.workspaceId === wid);
      if (!n) return problem(404, 'Not found');
      const denied = need('EDITOR');
      if (denied) return denied;
      if (method === 'PATCH') return (n.body = body.body ?? n.body), (n.updatedAt = iso()), ok(n);
      if (method === 'DELETE') return k.notes.splice(k.notes.indexOf(n), 1), noContent();
    }
    return undefined;
  }

  return { knowledge: k, handle, recordFromRun, markStale };
}
