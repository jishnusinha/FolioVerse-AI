/**
 * Writer half of the in-memory fake API: manuscripts, scene documents with revisions, suggestions, Narrative DNA,
 * continuity issues, excerpts and research notes. Rules mirror apps/api/src/modules/writer (optimistic concurrency,
 * accept/undo checks, STALE on edit, SUPERSEDED on rerun, proposals-only extraction). Writer runs are scripted DEMO
 * runs that finish on the next GET in the workspace, so the UI's first refetch already sees the result.
 */

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const countWords = (t) => t.match(WORD)?.length ?? 0;
const squash = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const COLORS = ['green', 'blue', 'grey', 'gray', 'brown', 'hazel', 'amber', 'black'];
const PARENT = { PART: [null], CHAPTER: [null, 'PART'], SCENE: ['CHAPTER'] };
const INSTRUCTIONS = {
  rewrite: 'Rewrite for clarity and vividness, keeping meaning, POV and tense.',
  expand: 'Expand with sensory detail and interiority.',
  shorten: 'Tighten to about 60% of the length, keeping the key beats.',
  tone: 'Rewrite in a different tone.',
  dialogue: 'Make the dialogue more natural, with distinct voices.',
  continue: 'Continue the scene in the same voice.',
};

const inlineText = (n) => (n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(inlineText).join(''));
function blocksOf(doc) {
  const out = [];
  const walk = (n) => {
    if (n.attrs?.blockId) return void out.push({ blockId: n.attrs.blockId, type: n.type, text: inlineText(n) });
    for (const c of n.content ?? []) walk(c);
  };
  if (doc) walk(doc);
  return out;
}
const prose = (doc) => blocksOf(doc).filter((b) => b.type !== 'citation');
const docText = (doc) =>
  prose(doc)
    .map((b) => b.text)
    .join('\n\n');
const para = (blockId, text) => ({ type: 'paragraph', attrs: { blockId }, content: text ? [{ type: 'text', text }] : undefined });

/** Scripted rewrite variants (DEMO): an added closing beat, and a leaner version. */
export function fakeVariants(text, mode, tone) {
  const lean = text
    .split(' ')
    .filter((w) => !/^(very|just|really|twice|quite)$/i.test(w))
    .join(' ');
  const closing = mode === 'tone' && tone ? `, and everything felt ${tone}.` : ', and the night held its breath.';
  return [
    { text: /[.!?]$/.test(text) ? text.replace(/[.!?]$/, closing) : `${text}${closing}`, rationale: 'Adds a held closing beat.' },
    { text: lean === text ? `${text.replace(/[.!?]$/, '')}.` : lean, rationale: 'A leaner version.' },
  ];
}

/**
 * @param {{ db: any, uuid: () => string, iso: (minutesAgo?: number) => string, ok: Function, problem: Function, noContent: Function }} deps
 */
export function createFakeWriter({ db, uuid, iso, ok, problem, noContent }) {
  const w = { manuscripts: [], nodes: [], docs: [], revisions: [], suggestions: [], facts: [], links: [], issues: [], excerpts: [], notes: [], pending: [] };
  db.writer = w;
  const userId = () => db.user.id;
  const today = () => new Date().toISOString().slice(0, 10);

  function addNode(m, kind, title, parentId, position) {
    const n = { id: uuid(), workspaceId: m.workspaceId, manuscriptId: m.id, parentId, kind, title, position, pov: null, wordCount: 0, createdAt: iso() };
    w.nodes.push(n);
    if (kind === 'SCENE') addDoc(m, n, { type: 'doc', content: [para(uuid(), '')] });
    return n;
  }
  function addDoc(m, n, content, minutesAgo = 0) {
    const text = docText(content);
    const d = { id: uuid(), workspaceId: m.workspaceId, manuscriptId: m.id, nodeId: n.id, content, text, revision: 0, wordCount: countWords(text), updatedAt: iso(minutesAgo) };
    n.wordCount = d.wordCount;
    w.docs.push(d);
    return d;
  }

  function addManuscript(wid, title, projectId) {
    const m = { id: uuid(), workspaceId: wid, projectId, title, dailyGoal: 0, dayStart: null, dayStartWords: 0, dnaVersion: 0, archivedAt: null, deletedAt: null, createdAt: iso(), updatedAt: iso() };
    w.manuscripts.push(m);
    return m;
  }

  /** DEMO manuscript: two scenes, one canon fact and one paragraph that contradicts it. */
  function seed(wid, projectId) {
    const m = addManuscript(wid, 'The Glass Meridian', projectId);
    m.dailyGoal = 500;
    const part = addNode(m, 'PART', 'Part One · The Lighthouse Archive', null, 0);
    const ch = addNode(m, 'CHAPTER', 'Chapter One — Salt on the Lens', part.id, 0);
    const s1 = { id: uuid(), workspaceId: wid, manuscriptId: m.id, parentId: ch.id, kind: 'SCENE', title: 'The Storm Bell', position: 0, pov: 'Mara', wordCount: 0, createdAt: iso() };
    const s2 = { id: uuid(), workspaceId: wid, manuscriptId: m.id, parentId: ch.id, kind: 'SCENE', title: 'A Letter, Unopened', position: 1, pov: 'Mara', wordCount: 0, createdAt: iso() };
    w.nodes.push(s1, s2);
    const d1 = addDoc(
      m,
      s1,
      {
        type: 'doc',
        content: [
          para('blk-storm-1', 'The storm bell rang twice before Mara reached the lighthouse stairs.'),
          para('blk-storm-2', 'Mara pushed the wet hair from her face, her blue eyes narrowing at the dark water.'),
          para('blk-storm-3', 'Below, Tomas waited by the archive door, eleven winters older than the boy who left.'),
        ],
      },
      30,
    );
    addDoc(
      m,
      s2,
      {
        type: 'doc',
        content: [para('blk-letter-1', 'The letter from Tomas lay on the chart table, its seal unbroken.'), para('blk-letter-2', 'Mara read the harbor lights instead, one by one, until the lamp burned low.')],
      },
      20,
    );
    w.revisions.push({ id: uuid(), docId: d1.id, revision: 0, origin: 'AUTHOR', content: d1.content, text: d1.text, wordCount: d1.wordCount, note: null, createdById: userId(), createdAt: iso(30), updatedAt: iso(30) });
    w.facts.push({
      id: uuid(),
      workspaceId: wid,
      manuscriptId: m.id,
      subject: 'Mara',
      subjectKind: 'CHARACTER',
      predicate: 'eye color',
      value: 'green',
      statement: 'Mara: eye color is green.',
      status: 'CANON',
      origin: 'AUTHOR',
      confidence: null,
      evidence: [],
      note: null,
      isDemo: true,
      createdAt: iso(40),
    });
    m.dnaVersion = 1;
    return m;
  }

  const ms = (wid, id) => w.manuscripts.find((m) => m.id === id && m.workspaceId === wid && !m.deletedAt);
  const nodesOf = (m) => w.nodes.filter((n) => n.manuscriptId === m.id).sort((a, b) => a.position - b.position);
  const docOf = (n) => w.docs.find((d) => d.nodeId === n.id);
  const words = (m) => w.nodes.filter((n) => n.manuscriptId === m.id && n.kind === 'SCENE').reduce((a, n) => a + n.wordCount, 0);
  const stats = (m) => ({ words: words(m), todayWords: m.dayStart === today() ? Math.max(0, words(m) - m.dayStartWords) : 0, dailyGoal: m.dailyGoal });
  const runOf = (id) => db.ai.runs.find((r) => r.id === id);
  const runView = (id) => {
    const r = runOf(id);
    return r ? { id: r.id, status: r.status, outcome: r.outcome, isDemo: r.isDemo, error: r.error } : null;
  };

  function newRun(wid, graph, input, tier) {
    const run = {
      id: uuid(),
      workspaceId: wid,
      threadId: null,
      messageId: null,
      graph,
      tier,
      status: 'QUEUED',
      outcome: null,
      isDemo: true,
      lab: false,
      input,
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
    w.pending.push(run.id);
    return run;
  }

  /** Finishes queued writer runs and applies their artifacts, as the executor's finalize step does. */
  function settle() {
    const ids = w.pending.splice(0);
    for (const id of ids) {
      const run = runOf(id);
      if (!run || run.status !== 'QUEUED') continue;
      Object.assign(run, { status: 'SUCCEEDED', outcome: 'ANSWERED', startedAt: iso(), finishedAt: iso() });
      const p = run.input.params;
      if (run.graph === 'writer_revision') {
        const s = w.suggestions.find((x) => x.id === p.suggestionId && x.runId === run.id);
        if (s) s.variants = fakeVariants(p.text, p.mode, p.tone);
      } else if (run.graph === 'continuity_check') recordIssues(run, p);
      else if (run.graph === 'dna_extraction') recordDna(run, p);
    }
  }

  function recordIssues(run, p) {
    const m = w.manuscripts.find((x) => x.id === p.manuscriptId);
    const node = w.nodes.find((n) => n.id === p.nodeId);
    const doc = node && docOf(node);
    if (!m || !doc) return;
    const seen = new Set();
    for (const f of w.facts.filter((x) => x.manuscriptId === m.id && x.status === 'CANON' && x.predicate && COLORS.includes(String(x.value).toLowerCase()))) {
      for (const b of prose(doc.content)) {
        for (const sentence of b.text.split(/(?<=[.!?])\s+/)) {
          const low = sentence.toLowerCase();
          if (!low.includes(f.subject.toLowerCase())) continue;
          const found = COLORS.find((c) => c !== String(f.value).toLowerCase() && new RegExp(`\\b${c}\\b`).test(low));
          if (!found) continue;
          const fingerprint = [node.id, f.subject, f.predicate, found, squash(sentence).toLowerCase()].join('|');
          seen.add(fingerprint);
          const existing = w.issues.find((i) => i.manuscriptId === m.id && i.fingerprint === fingerprint);
          if (existing) {
            if (existing.state === 'RESOLVED') existing.state = 'OPEN';
            existing.runId = run.id;
            continue;
          }
          w.issues.push({
            id: uuid(),
            workspaceId: m.workspaceId,
            manuscriptId: m.id,
            nodeId: node.id,
            blockId: b.blockId,
            runId: run.id,
            factId: f.id,
            entity: f.subject,
            fact: f.predicate,
            expected: f.value,
            found,
            quote: sentence,
            severity: 'HIGH',
            state: 'OPEN',
            fingerprint,
            isDemo: true,
            anchors: [
              { role: 'scene', nodeId: node.id, blockId: b.blockId, quote: sentence },
              { role: 'canon', factId: f.id, statement: f.statement },
            ],
            createdAt: iso(),
          });
        }
      }
    }
    for (const i of w.issues) if (i.manuscriptId === m.id && i.nodeId === node.id && i.state === 'OPEN' && !seen.has(i.fingerprint)) i.state = 'RESOLVED';
  }

  function recordDna(run, p) {
    const m = w.manuscripts.find((x) => x.id === p.manuscriptId);
    if (!m) return;
    const counts = new Map();
    for (const name of p.text.match(/\b[A-Z][a-z]{2,}\b/g) ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
    const names = [...counts].filter(([n, c]) => c >= 2 && !['The', 'Below'].includes(n)).map(([n]) => n);
    const locate = (name) => {
      for (const n of w.nodes.filter((x) => x.manuscriptId === m.id && x.kind === 'SCENE')) {
        const b = prose(docOf(n)?.content).find((x) => x.text.includes(name));
        if (b) return [{ nodeId: n.id, blockId: b.blockId, quote: b.text.split(/(?<=[.!?])\s+/).find((s) => s.includes(name)) ?? b.text }];
      }
      return [];
    };
    for (const name of names) {
      if (w.facts.some((f) => f.manuscriptId === m.id && f.subject === name && !f.predicate)) continue;
      w.facts.push({
        id: uuid(),
        workspaceId: m.workspaceId,
        manuscriptId: m.id,
        subject: name,
        subjectKind: 'CHARACTER',
        predicate: null,
        value: null,
        statement: `${name} is a character in the story.`,
        status: 'PROPOSED',
        origin: 'AI_EXTRACTED',
        confidence: 0.8,
        evidence: locate(name),
        runId: run.id,
        note: null,
        isDemo: true,
        createdAt: iso(),
      });
    }
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const [a, b] = [names[i], names[j]];
        if (w.links.some((l) => l.manuscriptId === m.id && ((l.source === a && l.target === b) || (l.source === b && l.target === a)))) continue;
        w.links.push({ id: uuid(), workspaceId: m.workspaceId, manuscriptId: m.id, source: a, target: b, kind: 'APPEARS_WITH', label: 'appears with', weight: 2, status: 'PROPOSED', origin: 'AI_EXTRACTED', evidence: [], isDemo: true, createdAt: iso() });
      }
    }
  }

  /** EXACT when the quote is still in its block, SHIFTED when it moved, ORPHANED when it is gone. */
  function resolve(ev) {
    const node = w.nodes.find((n) => n.id === ev.nodeId);
    const doc = node && docOf(node);
    if (!doc || !ev.quote) return { ...ev, state: 'ORPHANED' };
    const blocks = prose(doc.content);
    if (blocks.find((b) => b.blockId === ev.blockId)?.text.includes(ev.quote)) return { ...ev, state: 'EXACT' };
    const moved = blocks.find((b) => b.text.includes(ev.quote));
    return moved ? { ...ev, blockId: moved.blockId, state: 'SHIFTED' } : { ...ev, state: 'ORPHANED' };
  }

  function snapshot(d, revision, origin, note) {
    const last = w.revisions.filter((r) => r.docId === d.id).sort((a, b) => b.revision - a.revision)[0];
    const data = { revision, content: structuredClone(d.content), text: d.text, wordCount: d.wordCount, updatedAt: iso() };
    if (origin === 'AUTHOR' && last?.origin === 'AUTHOR' && Date.now() - new Date(last.createdAt).getTime() < 5 * 60_000) return void Object.assign(last, data);
    w.revisions.push({ id: uuid(), docId: d.id, origin, note: note ?? null, createdById: userId(), createdAt: iso(), ...data });
  }

  function saveDoc(m, n, body, restoreOf) {
    const d = docOf(n);
    if (!body?.content || body.content.type !== 'doc') return problem(400, 'Content must be a TipTap document', 'INVALID_DOCUMENT');
    if (body.revision !== d.revision) {
      const res = problem(409, 'This scene was changed elsewhere since you loaded it', 'REVISION_CONFLICT');
      res.body.current = { revision: d.revision, content: d.content, text: d.text, updatedAt: d.updatedAt };
      return res;
    }
    const before = new Map(blocksOf(d.content).map((b) => [b.blockId, b.text]));
    const after = new Map(blocksOf(body.content).map((b) => [b.blockId, b.text]));
    let origin = restoreOf != null ? 'RESTORE' : 'AUTHOR';
    let decided = null;
    if (body.action) {
      const s = w.suggestions.find((x) => x.id === body.suggestionId && x.docId === d.id);
      if (!s) return problem(404, 'Suggestion not found');
      if (body.action === 'accept') {
        if (s.state !== 'PENDING') return problem(409, `This suggestion is ${s.state.toLowerCase()}`, 'SUGGESTION_NOT_PENDING');
        const v = s.variants?.[body.variant ?? 0];
        if (!v) return problem(400, 'Unknown variant', 'UNKNOWN_VARIANT');
        if (squash(before.get(s.blockId)) !== squash(s.baseText)) {
          s.state = 'STALE';
          return problem(409, 'The paragraph changed after this suggestion was generated', 'SUGGESTION_STALE');
        }
        if (squash(after.get(s.blockId)) !== squash(v.text)) return problem(400, 'The saved paragraph does not match the accepted variant', 'VARIANT_MISMATCH');
        origin = 'POST_AI';
        decided = () => Object.assign(s, { state: 'ACCEPTED', chosen: body.variant ?? 0, appliedRevision: d.revision });
      } else {
        if (s.state !== 'ACCEPTED') return problem(409, 'Only an accepted suggestion can be undone', 'SUGGESTION_NOT_ACCEPTED');
        if (squash(after.get(s.blockId)) !== squash(s.baseText)) return problem(400, 'The saved paragraph does not match the original text', 'VARIANT_MISMATCH');
        origin = 'UNDO';
        decided = () => Object.assign(s, { state: 'PENDING', chosen: null, appliedRevision: null });
      }
    }
    if (m.dayStart !== today()) Object.assign(m, { dayStart: today(), dayStartWords: words(m) });
    d.content = structuredClone(body.content);
    d.text = docText(d.content);
    d.wordCount = countWords(d.text);
    d.revision += 1;
    d.updatedAt = iso();
    n.wordCount = d.wordCount;
    m.updatedAt = iso();
    decided?.();
    snapshot(d, d.revision, origin, restoreOf != null ? `Restored r${restoreOf}` : null);
    const stale = w.suggestions.filter((s) => s.docId === d.id && s.state === 'PENDING' && s.id !== body.suggestionId && squash(after.get(s.blockId) ?? '\u0000') !== squash(s.baseText));
    for (const s of stale) s.state = 'STALE';
    return ok({ revision: d.revision, wordCount: d.wordCount, origin, staleSuggestionIds: stale.map((s) => s.id), savedAt: iso(), stats: stats(m) });
  }

  function compile(m) {
    const sections = [];
    const footnotes = [];
    const visit = (pid) => {
      for (const n of nodesOf(m).filter((x) => (x.parentId ?? null) === pid)) {
        const blocks = [];
        for (const b of n.kind === 'SCENE' ? blocksOf(docOf(n)?.content) : []) {
          if (b.type === 'citation') {
            footnotes.push(b.text);
            blocks.push({ type: 'citation', text: b.text, footnote: footnotes.length });
          } else if (b.text.trim()) blocks.push({ type: b.type === 'heading' ? 'heading' : 'paragraph', text: b.text });
        }
        sections.push({ kind: n.kind, title: n.title, blocks });
        visit(n.id);
      }
    };
    visit(null);
    return { title: m.title, sections, footnotes, words: words(m) };
  }

  const get = (m) => ({ ...m, project: { id: m.projectId, name: m.title }, nodes: nodesOf(m), stats: stats(m) });

  /** @returns {{ status: number, headers: Record<string,string>, body: any } | undefined} */
  function handle(method, wid, rest, body, need, query) {
    if (method === 'GET') settle();
    const r = rest.join('/');

    if (r === 'excerpts' && method === 'GET') return ok(w.excerpts.filter((e) => e.workspaceId === wid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    if (r === 'excerpts' && method === 'POST') {
      const denied = need('EDITOR');
      if (denied) return denied;
      const s = db.sources.find((x) => x.id === body?.sourceId && x.workspaceId === wid && !x.deletedAt);
      if (!s) return problem(404, 'Source not found');
      const e = { id: uuid(), workspaceId: wid, sourceId: s.id, sourceVersionId: body.sourceVersionId ?? s.currentVersionId, projectId: s.projectId, title: s.title, quote: body.quote, anchor: body.anchor ?? null, createdAt: iso() };
      w.excerpts.push(e);
      return ok(e, 201);
    }
    if (rest[0] === 'excerpts' && rest[1] && method === 'DELETE') {
      const denied = need('EDITOR');
      if (denied) return denied;
      const i = w.excerpts.findIndex((e) => e.id === rest[1] && e.workspaceId === wid);
      if (i < 0) return problem(404, 'Not found');
      w.excerpts.splice(i, 1);
      return noContent();
    }

    if (rest[0] === 'suggestions' && rest[1] && method === 'PATCH') {
      const denied = need('EDITOR');
      if (denied) return denied;
      const s = w.suggestions.find((x) => x.id === rest[1] && x.workspaceId === wid);
      if (!s) return problem(404, 'Suggestion not found');
      const allowed = body.state === 'REJECTED' ? ['PENDING', 'STALE'] : ['REJECTED'];
      if (!allowed.includes(s.state)) return problem(409, `A ${s.state.toLowerCase()} suggestion cannot become ${String(body.state).toLowerCase()}`, 'INVALID_TRANSITION');
      if (body.state === 'PENDING') {
        const cur = prose(w.docs.find((d) => d.id === s.docId)?.content).find((b) => b.blockId === s.blockId)?.text;
        s.state = cur != null && squash(cur) === squash(s.baseText) ? 'PENDING' : 'STALE';
      } else s.state = 'REJECTED';
      return ok(s);
    }

    if (r === 'manuscripts' && method === 'GET') {
      return ok(
        w.manuscripts
          .filter((m) => m.workspaceId === wid && !m.deletedAt)
          .map((m) => ({ ...m, words: words(m), scenes: w.nodes.filter((n) => n.manuscriptId === m.id && n.kind === 'SCENE').length })),
      );
    }
    if (r === 'manuscripts' && method === 'POST') {
      const denied = need('EDITOR');
      if (denied) return denied;
      if (!body?.title?.trim()) return problem(400, 'title should not be empty', 'VALIDATION');
      const project = { id: uuid(), workspaceId: wid, name: body.title, kind: 'WRITER', description: '', archivedAt: null, deletedAt: null, createdAt: iso(), updatedAt: iso() };
      db.projects.push(project);
      const m = addManuscript(wid, body.title, project.id);
      const part = addNode(m, 'PART', 'Part One', null, 0);
      const ch = addNode(m, 'CHAPTER', 'Chapter 1', part.id, 0);
      addNode(m, 'SCENE', 'Scene 1', ch.id, 0);
      return ok(get(m), 201);
    }
    if (rest[0] !== 'manuscripts' || !rest[1]) return undefined;

    const m = ms(wid, rest[1]);
    if (!m) return problem(404, 'Not found');
    const sub = rest.slice(2);
    const s2 = sub.join('/');
    const write = method !== 'GET' ? need('EDITOR') : null;
    if (write) return write;

    if (sub.length === 0) {
      if (method === 'GET') return ok(get(m));
      if (method === 'PATCH') {
        if (body.title !== undefined) m.title = body.title;
        if (body.dailyGoal !== undefined) m.dailyGoal = body.dailyGoal;
        if (body.archived !== undefined) m.archivedAt = body.archived ? iso() : null;
        return ok(get(m));
      }
      if (method === 'DELETE') return (m.deletedAt = iso()), noContent();
    }

    if (s2 === 'compiled' && method === 'GET') return ok(compile(m));
    if (s2 === 'export' && method === 'GET') {
      const c = compile(m);
      const md = [`# ${c.title}`, ...c.sections.flatMap((s) => [s.kind === 'SCENE' ? '' : `${s.kind === 'PART' ? '##' : '###'} ${s.title}`, ...s.blocks.map((b) => (b.type === 'citation' ? `[^${b.footnote}]` : b.text))])].join('\n\n');
      return { status: 200, headers: { 'content-type': 'text/markdown; charset=utf-8' }, body: md };
    }

    if (sub[0] === 'nodes') {
      if (sub.length === 1 && method === 'POST') {
        const parent = body.parentId ? w.nodes.find((n) => n.id === body.parentId && n.manuscriptId === m.id) : null;
        if (body.parentId && !parent) return problem(404, 'Parent not found');
        if (!PARENT[body.kind]?.includes(parent?.kind ?? null)) return problem(400, 'Invalid parent', 'INVALID_PARENT');
        const count = w.nodes.filter((n) => n.manuscriptId === m.id && (n.parentId ?? null) === (body.parentId ?? null)).length;
        return ok(addNode(m, body.kind, body.title, body.parentId ?? null, count), 201);
      }
      const n = w.nodes.find((x) => x.id === sub[1] && x.manuscriptId === m.id);
      if (!n) return problem(404, 'Not found');
      if (sub.length === 2 && method === 'PATCH') {
        if (body.title !== undefined) n.title = body.title;
        if (body.position !== undefined) {
          const sibs = nodesOf(m).filter((x) => (x.parentId ?? null) === (n.parentId ?? null) && x.id !== n.id);
          sibs.splice(Math.min(body.position, sibs.length), 0, n);
          sibs.forEach((x, i) => (x.position = i));
        }
        return ok(n);
      }
      if (sub.length === 2 && method === 'DELETE') {
        const ids = new Set([n.id]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const x of w.nodes) if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) (ids.add(x.id), (grew = true));
        }
        w.nodes = w.nodes.filter((x) => !ids.has(x.id));
        w.suggestions = w.suggestions.filter((x) => !ids.has(x.nodeId));
        w.issues = w.issues.filter((x) => !ids.has(x.nodeId));
        return noContent();
      }
      if (n.kind !== 'SCENE') return problem(400, 'Not a scene', 'NOT_A_SCENE');
      const d = docOf(n);
      const sp = sub.slice(2).join('/');
      if (sp === 'doc' && method === 'GET') return ok({ id: d.id, nodeId: n.id, content: d.content, text: d.text, revision: d.revision, wordCount: d.wordCount, updatedAt: d.updatedAt });
      if (sp === 'doc' && method === 'PATCH') return saveDoc(m, n, body);
      if (sp === 'doc/revisions' && method === 'GET') {
        return ok(
          w.revisions
            .filter((x) => x.docId === d.id)
            .sort((a, b) => b.revision - a.revision)
            .map(({ content: _c, text: _t, ...x }) => x),
        );
      }
      if (sub[2] === 'doc' && sub[3] === 'revisions' && sub[4]) {
        const rev = w.revisions.find((x) => x.docId === d.id && x.revision === Number(sub[4]));
        if (!rev) return problem(404, 'Revision not found');
        if (sub.length === 5 && method === 'GET') return ok(rev);
        if (sub[5] === 'restore' && method === 'POST') return saveDoc(m, n, { content: rev.content, revision: body.revision }, rev.revision);
      }
      if (sp === 'suggestions' && method === 'POST') {
        const blocks = prose(d.content).filter((b) => b.text.trim());
        const picked = body.all ? blocks.slice(0, 20) : blocks.filter((b) => body.blockIds?.includes(b.blockId));
        if (!picked.length) return problem(400, 'Select at least one paragraph with text', 'NO_TEXT');
        const batchId = picked.length > 1 ? uuid() : null;
        const instruction = body.instruction?.trim() || (body.mode === 'tone' && body.tone ? `Rewrite in a ${body.tone} tone.` : INSTRUCTIONS[body.mode]);
        const out = [];
        for (const b of picked) {
          for (const s of w.suggestions) if (s.docId === d.id && s.blockId === b.blockId && ['PENDING', 'STALE'].includes(s.state)) s.state = 'SUPERSEDED';
          const id = uuid();
          const run = newRun(wid, 'writer_revision', { text: b.text, params: { text: b.text, mode: body.mode, tone: body.tone, instruction, manuscriptId: m.id, nodeId: n.id, blockId: b.blockId, suggestionId: id } }, 'T0');
          w.suggestions.push({
            id,
            workspaceId: wid,
            manuscriptId: m.id,
            docId: d.id,
            nodeId: n.id,
            blockId: b.blockId,
            batchId,
            runId: run.id,
            mode: body.mode,
            tone: body.tone ?? null,
            instruction,
            state: 'PENDING',
            baseRevision: d.revision,
            baseText: b.text,
            variants: [],
            chosen: null,
            appliedRevision: null,
            fallback: false,
            isDemo: true,
            createdAt: iso(),
          });
          out.push({ id, blockId: b.blockId, runId: run.id, estimate: '0.00020000' });
        }
        return ok({ batchId, suggestions: out, budgetRejected: false }, 201);
      }
    }

    if (s2 === 'suggestions' && method === 'GET') {
      const rows = w.suggestions.filter((s) => s.manuscriptId === m.id && (!query.get('nodeId') || s.nodeId === query.get('nodeId')) && (!query.get('state') || s.state === query.get('state')));
      return ok(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((s) => ({ ...s, run: runView(s.runId) })));
    }

    if (s2 === 'dna' && method === 'GET') {
      return ok({
        version: m.dnaVersion,
        openIssues: w.issues.filter((i) => i.manuscriptId === m.id && i.state === 'OPEN').length,
        facts: w.facts.filter((f) => f.manuscriptId === m.id).map((f) => ({ ...f, evidence: (f.evidence ?? []).map(resolve) })),
        links: w.links.filter((l) => l.manuscriptId === m.id),
      });
    }
    if (s2 === 'dna/facts' && method === 'POST') {
      const statement = body.statement?.trim() || (body.predicate && body.value ? `${body.subject}: ${body.predicate} is ${body.value}.` : '');
      if (!statement) return problem(400, 'Give a statement, or a predicate and value', 'VALIDATION');
      const f = { id: uuid(), workspaceId: wid, manuscriptId: m.id, subject: body.subject, subjectKind: body.subjectKind ?? 'CHARACTER', predicate: body.predicate ?? null, value: body.value ?? null, statement, status: 'CANON', origin: 'AUTHOR', confidence: null, evidence: [], note: null, isDemo: false, createdAt: iso() };
      w.facts.push(f);
      m.dnaVersion += 1;
      return ok(f, 201);
    }
    if (sub[0] === 'dna' && sub[1] === 'facts' && sub[2] && method === 'PATCH') {
      const f = w.facts.find((x) => x.id === sub[2] && x.manuscriptId === m.id);
      if (!f) return problem(404, 'Fact not found');
      if (body.status === 'RETIRED' && f.status === 'PROPOSED' && !body.note) f.note = 'Rejected by author';
      Object.assign(f, Object.fromEntries(Object.entries(body).filter(([k]) => ['status', 'statement', 'value', 'note'].includes(k))));
      m.dnaVersion += 1;
      return ok(f);
    }
    if (s2 === 'dna/links' && method === 'POST') {
      const l = { id: uuid(), workspaceId: wid, manuscriptId: m.id, source: body.source, target: body.target, kind: 'AUTHOR', label: body.label, weight: 1, status: 'CANON', origin: 'AUTHOR', evidence: [], createdAt: iso() };
      w.links.push(l);
      m.dnaVersion += 1;
      return ok(l, 201);
    }
    if (sub[0] === 'dna' && sub[1] === 'links' && sub[2] && method === 'PATCH') {
      const l = w.links.find((x) => x.id === sub[2] && x.manuscriptId === m.id);
      if (!l) return problem(404, 'Link not found');
      l.status = body.status;
      m.dnaVersion += 1;
      return ok(l);
    }
    const scenesWithText = (ids) =>
      nodesOf(m)
        .filter((n) => n.kind === 'SCENE' && (!ids || ids.includes(n.id)))
        .map((n) => ({ n, text: docText(docOf(n)?.content) }))
        .filter((x) => x.text.trim());
    if (s2 === 'dna/extract' && method === 'POST') {
      const scenes = scenesWithText(body?.nodeIds);
      if (!scenes.length) return problem(400, 'Write something first: there is no scene text to read', 'NO_TEXT');
      const text = scenes.map((s) => s.text).join('\n\n');
      const run = newRun(wid, 'dna_extraction', { text, params: { text, manuscriptId: m.id, nodeIds: scenes.map((s) => s.n.id) } }, 'T1');
      return ok({ runId: run.id, status: 'QUEUED', estimate: '0.00100000', model: run.modelPlan.primary }, 201);
    }
    if (s2 === 'continuity' && method === 'GET') {
      const title = new Map(nodesOf(m).map((n) => [n.id, n.title]));
      return ok(
        w.issues
          .filter((i) => i.manuscriptId === m.id)
          .map((i) => ({ ...i, sceneTitle: title.get(i.nodeId) ?? null, anchors: i.anchors.map((a) => (a.nodeId ? { ...a, ...resolve(a), sceneTitle: title.get(a.nodeId) ?? null } : a)) })),
      );
    }
    if (s2 === 'continuity/check' && method === 'POST') {
      if (!w.facts.some((f) => f.manuscriptId === m.id && f.status === 'CANON')) return problem(400, 'Approve some canon facts first: checks compare scenes with canon', 'NO_CANON');
      const scenes = scenesWithText(body?.nodeIds).slice(0, 20);
      if (!scenes.length) return problem(400, 'There is no scene text to check', 'NO_TEXT');
      return ok(
        {
          runs: scenes.map((s) => {
            const run = newRun(wid, 'continuity_check', { text: s.text, params: { text: s.text, manuscriptId: m.id, nodeId: s.n.id } }, 'T1');
            return { nodeId: s.n.id, runId: run.id, status: 'QUEUED' };
          }),
        },
        201,
      );
    }
    if (sub[0] === 'continuity' && sub[1] && method === 'PATCH') {
      const i = w.issues.find((x) => x.id === sub[1] && x.manuscriptId === m.id);
      if (!i) return problem(404, 'Issue not found');
      i.state = body.state;
      return ok(i);
    }

    if (s2 === 'research-notes' && method === 'GET') return ok(w.notes.filter((x) => x.manuscriptId === m.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    if (s2 === 'research-notes' && method === 'POST') {
      const e = body.excerptId ? w.excerpts.find((x) => x.id === body.excerptId && x.workspaceId === wid) : null;
      if (body.excerptId && !e) return problem(404, 'Excerpt not found');
      const title = body.title?.trim() || e?.title || '';
      if (!title && !body.body?.trim()) return problem(400, 'A note needs a title, text or an excerpt', 'VALIDATION');
      const note = {
        id: uuid(),
        workspaceId: wid,
        manuscriptId: m.id,
        nodeId: body.nodeId ?? null,
        excerptId: e?.id ?? null,
        title: title || body.body.trim().slice(0, 80),
        body: body.body ?? '',
        quote: e?.quote ?? null,
        source: e ? { sourceId: e.sourceId, sourceVersionId: e.sourceVersionId, projectId: e.projectId, title: e.title, anchor: e.anchor } : null,
        createdAt: iso(),
      };
      w.notes.push(note);
      return ok(note, 201);
    }
    if (sub[0] === 'research-notes' && sub[1]) {
      const note = w.notes.find((x) => x.id === sub[1] && x.manuscriptId === m.id);
      if (!note) return problem(404, 'Note not found');
      if (method === 'DELETE') return (w.notes = w.notes.filter((x) => x !== note)), noContent();
      if (method === 'PATCH') return Object.assign(note, { title: body.title ?? note.title, body: body.body ?? note.body }), ok(note);
    }
    return problem(404, 'Not found');
  }

  return { writer: w, handle, seed, settle };
}
