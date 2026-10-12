/**
 * Library and reader routes of the in-memory fake API (DEMO data). Rules mirror apps/api/src/modules/library:
 * items are private to their reader, annotations sync with `?since=` and tombstones, explain needs a placeable
 * locator and only sees the book up to the passage.
 */
import { pageForLocator } from '../features/reader/locator.js';

const STREAM_BASE = 1_760_000_000_000;

/** "Orbit of Small Lanterns" (datasets/synthetic/make_books.py), chapter-numbered like the ingested EPUB. */
export const LANTERNS = {
  title: 'Orbit of Small Lanterns',
  authors: ['Anaïs Verhoeven'],
  chapters: [
    {
      page: 1,
      href: 'chapter-1.xhtml',
      idref: 'chapter_0',
      title: 'Chapter 1 — The Halcyon Ring',
      paragraphs: [
        "Ilse Varga woke to the hum of the Halcyon Ring turning beneath her, the station's slow orbit carrying the archive decks out of the planet's shadow and into thin gold light.",
        'Every evening someone lit the small lanterns along the outer corridor. Nobody on the duty roster admitted to doing it, and the lanterns burned with a pale albedo that no supply crate explained.',
        'Ilse had come to the ring to catalogue its library: eleven thousand paper books, carried up a century ago by settlers who did not trust anything that needed a power supply to be read.',
      ],
    },
    {
      page: 2,
      href: 'chapter-2.xhtml',
      idref: 'chapter_1',
      title: 'Chapter 2 — The Archivist',
      paragraphs: [
        'Teodor Lusk had kept the archive for thirty years. He spoke to the books as if they were patients, and he wrote his notes in a cipher of his own invention that he called marginalia.',
        "He showed Ilse the oldest shelf, where the settlers' journals were kept in airtight sleeves, and explained that the ring passed perihelion every ninety-one days, when the light grew harsh enough to fade ink.",
      ],
    },
    {
      page: 3,
      href: 'chapter-3.xhtml',
      idref: 'chapter_2',
      title: 'Chapter 3 — A Lantern Fails',
      paragraphs: [
        'On the night before perihelion, the lantern outside the archive guttered and went dark. Ilse waited in the corridor with her notebook and a thermos, determined to see who would come to relight it.',
      ],
    },
    {
      page: 4,
      href: 'chapter-4.xhtml',
      idref: 'chapter_3',
      title: 'Chapter 4 — Perihelion',
      paragraphs: ["The keeper of the lanterns was Ilse's mother, Rhea Varga, who had never left the station."],
    },
  ],
};
const CHAPTERS = LANTERNS.chapters.map(({ paragraphs: _p, ...c }) => c);

const EXPLAIN = {
  define: (p) => `“${p.split(/\s+/).slice(0, 3).join(' ')}…” here uses its everyday sense; in this chapter it describes the station's routine [S1].`,
  explain: (p, ch) => `In ${ch}, this passage sets up the mystery of who tends the lanterns: the narrator notes the detail without explaining it [S1].`,
  summarize: (p, ch) => `${ch} so far: Ilse notices the lanterns and starts asking who lights them [S1].`,
  ask: (p, ch, q) => `Based on ${ch} and earlier pages only: the book has not answered “${q}” yet, but the passage hints at it [S1].`,
  context: (p, ch) => `Background from earlier pages of ${ch}: the archive and its lanterns are introduced [S1].`,
};

/**
 * @param {{ db: any, uuid: () => string, iso: (minutesAgo?: number) => string, ok: Function, problem: Function, noContent: Function,
 *   excerpts: any[], opts: { metadata?: boolean } }} deps
 */
export function createFakeLibrary({ db, uuid, iso, ok, problem, noContent, excerpts, opts }) {
  const L = { books: [], items: [], progress: [], annotations: [], bookmarks: [], collections: [], links: [], sessions: [], chapters: new Map() };
  db.library = L;
  const me = () => db.user.id;
  const source = (wid, id) => (id ? db.sources.find((s) => s.id === id && s.workspaceId === wid && !s.deletedAt) : null);
  const chaptersOf = (s) => (s ? (L.chapters.get(s.currentVersionId) ?? []) : []);
  let lastStamp = 0;
  /** Strictly increasing time, so a `?since=` delta never misses a change made in the same millisecond. */
  const stamp = () => new Date((lastStamp = Math.max(Date.now(), lastStamp + 1))).toISOString();
  const tone = (title) => ([...title].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 6) + 1;

  function addBook(wid, fields, extra = {}) {
    const b = {
      id: uuid(),
      workspaceId: wid,
      title: fields.title,
      subtitle: fields.subtitle ?? null,
      authors: fields.authors ?? [],
      language: fields.language ?? null,
      publisher: fields.publisher ?? null,
      publishedYear: fields.publishedYear ?? null,
      isbn13: fields.isbn13 ?? null,
      description: fields.description ?? null,
      subjects: fields.subjects ?? [],
      pageCount: fields.pageCount ?? null,
      coverUrl: fields.coverUrl ?? null,
      coverTone: tone(fields.title),
      metadataSource: fields.metadataSource ?? 'MANUAL',
      externalIds: fields.externalIds ?? {},
      isDemo: true,
      createdAt: iso(),
      updatedAt: iso(),
      ...extra,
    };
    L.books.push(b);
    return b;
  }
  function addItem(wid, book, { sourceId = null, status = 'TO_READ', minutesAgo = 0 } = {}) {
    const at = iso(minutesAgo);
    const it = {
      id: uuid(),
      workspaceId: wid,
      userId: me(),
      bookId: book.id,
      sourceId,
      status,
      rating: null,
      startedAt: status === 'READING' || status === 'FINISHED' ? at : null,
      finishedAt: status === 'FINISHED' ? at : null,
      lastOpenedAt: null,
      createdAt: at,
      updatedAt: at,
    };
    L.items.push(it);
    return it;
  }
  const bookOf = (it) => L.books.find((b) => b.id === it.bookId);
  const progressOf = (it) => L.progress.find((p) => p.itemId === it.id) ?? null;
  const collectionIds = (it) => L.links.filter((l) => l.itemId === it.id).map((l) => l.collectionId);
  const brief = (s) => (s ? { id: s.id, mimeType: s.mimeType, ingestionState: s.ingestionState } : null);
  const row = (wid, it) => ({ ...it, book: bookOf(it), progress: progressOf(it), collectionIds: collectionIds(it), source: brief(source(wid, it.sourceId)) });
  function detail(wid, it) {
    const s = source(wid, it.sourceId);
    const v = s && db.versions.find((x) => x.id === s.currentVersionId);
    return {
      ...it,
      book: bookOf(it),
      progress: progressOf(it),
      source: s ? { id: s.id, title: s.title, mimeType: s.mimeType, ingestionState: s.ingestionState, currentVersionId: s.currentVersionId, projectId: s.projectId } : null,
      version: v ? { id: v.id, mimeType: v.mimeType, pageCount: v.pageCount, ingestionState: v.ingestionState } : null,
      chapters: chaptersOf(s),
      collectionIds: collectionIds(it),
    };
  }
  const own = (wid, id) => L.items.find((x) => x.id === id && x.workspaceId === wid && x.userId === me());
  function addSeconds(wid, it, seconds, daysAgo = 0) {
    if (!seconds) return;
    const day = new Date(Date.now() - daysAgo * 86400_000).toISOString().slice(0, 10);
    const s = L.sessions.find((x) => x.itemId === it.id && x.day === day);
    if (s) s.seconds += seconds;
    else L.sessions.push({ id: uuid(), workspaceId: wid, userId: me(), itemId: it.id, day, seconds });
  }

  /** A READING EPUB with progress, highlights, a bookmark and two weeks of reading time; three manual books; one collection. */
  function seed(wid, project, addSource) {
    const s = addSource(project, 'Orbit of Small Lanterns.epub', 'READY', null, 2000);
    db.versions.find((v) => v.id === s.currentVersionId).pageCount = CHAPTERS.length;
    L.chapters.set(s.currentVersionId, CHAPTERS);
    const lanterns = addBook(wid, {
      title: LANTERNS.title,
      authors: LANTERNS.authors,
      language: 'en',
      publisher: 'FolioVerse Synthetic Press (DEMO)',
      publishedYear: 2024,
      subjects: ['Science fiction', 'Family'],
      description: 'A fictional DEMO novel: an archivist on an orbital station searches for whoever lights its lanterns.',
      pageCount: CHAPTERS.length,
      metadataSource: 'EPUB',
    });
    const reading = addItem(wid, lanterns, { sourceId: s.id, status: 'READING', minutesAgo: 1900 });
    reading.lastOpenedAt = iso(60);
    L.progress.push({
      id: uuid(),
      workspaceId: wid,
      userId: me(),
      itemId: reading.id,
      locator: { href: 'chapter-2.xhtml', type: 'application/xhtml+xml', title: CHAPTERS[1].title, locations: { cfi: 'epubcfi(/6/4[chapter_1]!/4/2/1:0)', totalProgression: 0.38 } },
      percent: 0.38,
      chapterIndex: 1,
      updatedAt: iso(60),
    });
    const quote = LANTERNS.chapters[0].paragraphs[1].slice(0, 70);
    L.annotations.push({
      id: uuid(),
      workspaceId: wid,
      userId: me(),
      itemId: reading.id,
      sourceVersionId: s.currentVersionId,
      kind: 'NOTE',
      color: 'sage',
      locator: { href: 'chapter-1.xhtml', title: CHAPTERS[0].title, locations: { cfi: 'epubcfi(/6/2[chapter_0]!/4/6,/1:0,/1:70)' }, text: { highlight: quote } },
      quote,
      note: 'Who lights them? Track every mention.',
      deletedAt: null,
      createdAt: iso(1500),
      updatedAt: iso(1500),
    });
    L.bookmarks.push({ id: uuid(), workspaceId: wid, userId: me(), itemId: reading.id, locator: { href: 'chapter-1.xhtml', title: CHAPTERS[0].title, locations: { cfi: 'epubcfi(/6/2[chapter_0]!/4/2/1:0)' } }, label: CHAPTERS[0].title, createdAt: iso(1800) });
    for (let d = 13; d >= 0; d--) if (d % 4 !== 3) addSeconds(wid, reading, 600 + ((d * 337) % 1500), d);

    const finished = addItem(wid, addBook(wid, { title: 'The Cartographer of Tides', authors: ['Maren Holt'], publishedYear: 2019, pageCount: 312 }), { status: 'FINISHED', minutesAgo: 9000 });
    addItem(wid, addBook(wid, { title: 'Notes on Quiet Machines', authors: ['Ade Okonjo'], publishedYear: 2022 }), { status: 'TO_READ', minutesAgo: 400 });
    addItem(wid, addBook(wid, { title: 'A Field Guide to Small Weathers', authors: ['Ines Calloway'], publishedYear: 2016 }), { status: 'ABANDONED', minutesAgo: 20000 });
    const c = { id: uuid(), workspaceId: wid, userId: me(), name: 'Space & archives', description: '', createdAt: iso(3000), updatedAt: iso(3000) };
    L.collections.push(c);
    L.links.push({ collectionId: c.id, itemId: reading.id }, { collectionId: c.id, itemId: finished.id });
    return { source: s, item: reading };
  }

  function stats(wid) {
    const mine = L.items.filter((i) => i.workspaceId === wid && i.userId === me());
    const counts = { TO_READ: 0, READING: 0, FINISHED: 0, ABANDONED: 0 };
    for (const i of mine) counts[i.status] += 1;
    const year = new Date().getUTCFullYear();
    const live = L.annotations.filter((a) => a.workspaceId === wid && a.userId === me() && !a.deletedAt);
    const sessions = L.sessions.filter((s) => s.workspaceId === wid && s.userId === me());
    const activity = Array.from({ length: 14 }, (_, k) => {
      const day = new Date(Date.now() - (13 - k) * 86400_000).toISOString().slice(0, 10);
      return { day, seconds: sessions.filter((s) => s.day === day).reduce((a, s) => a + s.seconds, 0) };
    });
    let streak = 0;
    for (let k = activity.length - 1; k >= 0 && activity[k].seconds > 0; k--) streak += 1;
    return {
      counts,
      finishedThisYear: mine.filter((i) => i.finishedAt && new Date(i.finishedAt).getUTCFullYear() === year).length,
      highlights: live.filter((a) => a.kind === 'HIGHLIGHT').length,
      notes: live.filter((a) => a.kind === 'NOTE').length,
      totalSeconds: sessions.reduce((a, s) => a + s.seconds, 0),
      activity,
      daysRead: activity.filter((a) => a.seconds > 0).length,
      streak,
    };
  }

  /** passage_explain events: bounded retrieval (spoiler guard), streamed answer, one validated citation from the current chapter. */
  function explainScript(run, { mode, passage, question, page, chapter, svid }) {
    const ev = [];
    let seq = 0;
    const at = new Date(run.createdAt).getTime();
    const push = (type, data) => {
      seq += 1;
      ev.push({ id: `${STREAM_BASE + seq}-0`, schemaVersion: 1, type, seq, ts: new Date(at + seq * 40).toISOString(), runId: run.id, data });
    };
    const chunkId = uuid();
    const quote = passage.slice(0, 120);
    const answer = EXPLAIN[mode](passage, chapter?.title ?? `chapter ${page}`, question);
    push('run.state', { status: 'RUNNING' });
    push('node.started', { node: 'gather_context', step: 1 });
    push('retrieval.completed', {
      candidates: 3,
      packed: 3,
      topScore: 1,
      contextTokens: 520,
      mode: 'reader',
      spoilerGuard: { pageMax: page, current: 1, earlier: page > 1 ? 1 : 0, summaries: page - 1 },
      sources: [{ marker: 'S1', chunkId, sourceVersionId: svid, page, score: 1 }],
    });
    push('node.finished', { node: 'gather_context', step: 1, status: 'SUCCEEDED', durationMs: 30 });
    push('node.started', { node: 'generate', step: 2 });
    push('run.state', { status: 'STREAMING' });
    for (const piece of answer.match(/.{1,20}(\s|$)|.+/g)) push('token.delta', { text: piece });
    push('node.finished', { node: 'generate', step: 2, status: 'SUCCEEDED', durationMs: 480 });
    const citation = { marker: 'S1', state: 'VALID', score: 1, quote, anchor: { sourceVersionId: svid, chunkId, state: 'EXACT', page, locator: { href: chapter?.href }, selectors: { textQuote: { exact: quote } } } };
    push('citation.validated', citation);
    push('usage.recorded', { provider: 'mock', model: 'mock-grounded', modelConfigId: 'mock-grounded', attempt: 1, status: 'SUCCEEDED', reported: true, usage: { inputTokens: 900, outputTokens: 60 }, isDemo: true });
    push('run.finished', { status: 'SUCCEEDED', outcome: 'ANSWERED', answer });
    return { events: ev, outcome: 'ANSWERED', answer, citations: [{ ...citation, sourceVersionId: svid, chunkId }], calls: 1 };
  }

  function explain(wid, it, body) {
    const s = source(wid, it.sourceId);
    if (!s?.currentVersionId) return problem(400, 'This book has no readable file', 'NO_FILE');
    if (body.mode === 'ask' && !body.question?.trim()) return problem(400, 'Ask needs a question', 'VALIDATION');
    const chapters = chaptersOf(s);
    const page = pageForLocator(chapters, body.locator ?? {});
    if (!page) return problem(400, 'The passage position could not be placed in the book', 'LOCATOR_UNKNOWN');
    const chapter = chapters.find((c) => c.page === page);
    const createdAt = iso();
    const run = {
      id: uuid(),
      workspaceId: wid,
      threadId: null,
      messageId: null,
      graph: 'passage_explain',
      tier: 'T0',
      status: 'QUEUED',
      outcome: null,
      isDemo: true,
      lab: false,
      input: { text: body.passage, question: body.question, params: { passage: body.passage, question: body.question, mode: body.mode, page, chapterTitle: chapter?.title ?? null, itemId: it.id } },
      scope: { sourceVersionIds: [s.currentVersionId] },
      modelPlan: { primary: { modelConfigId: 'mock-grounded', provider: 'mock', model: 'mock-grounded' }, fallbacks: [], isDemo: true },
      error: null,
      result: null,
      parentRunId: null,
      createdAt,
      startedAt: null,
      finishedAt: null,
    };
    db.ai.runs.push(run);
    db.ai.script.set(run.id, explainScript(run, { mode: body.mode, passage: body.passage, question: body.question, page, chapter, svid: s.currentVersionId }));
    return ok({ runId: run.id, threadId: null, messageId: null, status: 'QUEUED', estimate: '0.00012000', model: run.modelPlan.primary, page, chapterTitle: chapter?.title ?? null }, 201);
  }

  /** @returns {{ status: number, headers: Record<string,string>, body: any } | undefined} undefined when not a library route */
  function handle(method, wid, rest, body, need, query) {
    if (rest[0] !== 'library') return undefined;
    const [, a, id, sub, subId] = rest;

    if (a === 'items' && !id && method === 'GET') {
      const status = query.get('status');
      const cid = query.get('collectionId');
      const q = query.get('q')?.trim().toLowerCase();
      const rows = L.items
        .filter((i) => i.workspaceId === wid && i.userId === me())
        .filter((i) => !status || i.status === status)
        .filter((i) => !cid || L.links.some((l) => l.collectionId === cid && l.itemId === i.id))
        .filter((i) => !q || bookOf(i).title.toLowerCase().includes(q) || bookOf(i).authors.some((x) => x.toLowerCase() === q))
        .sort((x, y) => (y.lastOpenedAt ?? '').localeCompare(x.lastOpenedAt ?? '') || y.createdAt.localeCompare(x.createdAt));
      return ok(rows.map((i) => row(wid, i)));
    }
    if (a === 'items' && !id && method === 'POST') {
      if (!body?.sourceId && !body?.book) return problem(400, 'Provide a sourceId or book details', 'VALIDATION');
      const s = body.sourceId ? source(wid, body.sourceId) : null;
      if (body.sourceId && !s) return problem(404, 'Source not found');
      const existing = s && L.items.find((i) => i.workspaceId === wid && i.userId === me() && i.sourceId === s.id);
      if (existing) return ok(detail(wid, existing), 201);
      const book = addBook(wid, { ...(body.book ?? {}), title: body.book?.title ?? s.title.replace(/\.(epub|pdf)$/i, '') });
      return ok(detail(wid, addItem(wid, book, { sourceId: s?.id ?? null, status: body.status ?? 'TO_READ' })), 201);
    }
    if (a === 'items' && id) {
      const it = own(wid, id);
      if (!it) return problem(404, 'Not found');
      if (!sub && method === 'GET') return ok(detail(wid, it));
      if (!sub && method === 'PATCH') {
        if (body.rating !== undefined) it.rating = body.rating || null;
        if (body.status && body.status !== it.status) {
          const now = iso();
          it.status = body.status;
          if (body.status === 'TO_READ') Object.assign(it, { startedAt: null, finishedAt: null });
          if (body.status === 'READING') Object.assign(it, { startedAt: it.startedAt ?? now, finishedAt: null });
          if (body.status === 'FINISHED') Object.assign(it, { startedAt: it.startedAt ?? now, finishedAt: now });
          if (body.status === 'ABANDONED') it.finishedAt = null;
        }
        if (body.book) Object.assign(bookOf(it), body.book);
        it.updatedAt = iso();
        return ok(detail(wid, it));
      }
      if (!sub && method === 'DELETE') {
        for (const key of ['items', 'progress', 'annotations', 'bookmarks', 'links', 'sessions']) {
          L[key] = L[key].filter((x) => (key === 'items' ? x.id : x.itemId) !== it.id);
        }
        L.books = L.books.filter((b) => b.id !== it.bookId);
        return noContent();
      }
      if (sub === 'progress' && method === 'PUT') {
        const s = source(wid, it.sourceId);
        const chapters = chaptersOf(s);
        const page = pageForLocator(chapters, body.locator ?? {});
        const chapterIndex = page && chapters.length ? chapters.findIndex((c) => c.page === page) : null;
        let p = progressOf(it);
        if (!p) L.progress.push((p = { id: uuid(), workspaceId: wid, userId: me(), itemId: it.id }));
        Object.assign(p, { locator: body.locator, percent: body.percent, chapterIndex, updatedAt: iso() });
        it.lastOpenedAt = iso();
        if (it.status === 'TO_READ') Object.assign(it, { status: 'READING', startedAt: it.startedAt ?? iso() });
        addSeconds(wid, it, Math.min(3600, body.secondsDelta ?? 0));
        return ok(p);
      }
      if (sub === 'annotations' && !subId && method === 'GET') {
        const since = query.get('since');
        if (since && Number.isNaN(new Date(since).getTime())) return problem(400, 'since must be an ISO date-time', 'VALIDATION');
        const rows = L.annotations
          .filter((x) => x.itemId === it.id && x.userId === me() && (since ? x.updatedAt > since : !x.deletedAt))
          .sort((x, y) => x.updatedAt.localeCompare(y.updatedAt));
        return ok({ annotations: rows, serverTime: stamp() });
      }
      if (sub === 'annotations' && !subId && method === 'POST') {
        if (body.id) {
          const prior = L.annotations.find((x) => x.id === body.id);
          if (prior && prior.userId === me() && prior.itemId === it.id) return ok(prior, 201);
          if (prior) return problem(409, 'Annotation id already used', 'ID_CONFLICT');
        }
        if (body.kind === 'NOTE' && !body.note?.trim()) return problem(400, 'A note needs text', 'VALIDATION');
        const at = stamp();
        const created = {
          id: body.id ?? uuid(),
          workspaceId: wid,
          userId: me(),
          itemId: it.id,
          sourceVersionId: source(wid, it.sourceId)?.currentVersionId ?? null,
          kind: body.kind,
          color: body.color ?? 'amber',
          locator: body.locator,
          quote: body.quote ?? '',
          note: body.note?.trim() || null,
          deletedAt: null,
          createdAt: at,
          updatedAt: at,
        };
        L.annotations.push(created);
        return ok(created, 201);
      }
      if (sub === 'annotations' && subId) {
        const x = L.annotations.find((y) => y.id === subId && y.itemId === it.id && y.userId === me() && !y.deletedAt);
        if (!x) return problem(404, 'Annotation not found');
        if (method === 'PATCH') {
          if (body.color) x.color = body.color;
          if (body.note !== undefined) x.note = body.note.trim() || null;
          x.updatedAt = stamp();
          return ok(x);
        }
        if (method === 'DELETE') return (x.deletedAt = x.updatedAt = stamp()), noContent();
      }
      if (sub === 'bookmarks' && !subId && method === 'GET') return ok(L.bookmarks.filter((b) => b.itemId === it.id).sort((x, y) => x.createdAt.localeCompare(y.createdAt)));
      if (sub === 'bookmarks' && !subId && method === 'POST') {
        const b = { id: uuid(), workspaceId: wid, userId: me(), itemId: it.id, locator: body.locator, label: body.label?.trim() || body.locator?.title || '', createdAt: iso() };
        L.bookmarks.push(b);
        return ok(b, 201);
      }
      if (sub === 'bookmarks' && subId && method === 'DELETE') {
        const n = L.bookmarks.length;
        L.bookmarks = L.bookmarks.filter((b) => !(b.id === subId && b.itemId === it.id));
        return n === L.bookmarks.length ? problem(404, 'Bookmark not found') : noContent();
      }
      if (sub === 'explain' && method === 'POST') return need('EDITOR') ?? explain(wid, it, body);
      if (sub === 'excerpts' && method === 'POST') {
        const denied = need('EDITOR');
        if (denied) return denied;
        const s = source(wid, it.sourceId);
        const chapters = chaptersOf(s);
        const page = pageForLocator(chapters, body.locator ?? {});
        const e = {
          id: uuid(),
          workspaceId: wid,
          sourceId: s?.id ?? null,
          sourceVersionId: s?.currentVersionId ?? null,
          projectId: s?.projectId ?? null,
          title: bookOf(it).title,
          quote: body.quote,
          anchor: { itemId: it.id, locator: body.locator, page, chapterTitle: chapters.find((c) => c.page === page)?.title ?? null },
          createdAt: iso(),
        };
        excerpts.push(e);
        return ok(e, 201);
      }
    }

    if (a === 'collections' && !id && method === 'GET') {
      return ok(
        L.collections
          .filter((c) => c.workspaceId === wid && c.userId === me())
          .sort((x, y) => x.name.localeCompare(y.name))
          .map((c) => ({ ...c, itemCount: L.links.filter((l) => l.collectionId === c.id).length })),
      );
    }
    if (a === 'collections' && !id && method === 'POST') {
      const name = body?.name?.trim();
      if (!name) return problem(400, 'name should not be empty', 'VALIDATION');
      if (L.collections.some((c) => c.workspaceId === wid && c.userId === me() && c.name === name)) return problem(409, 'A collection with this name exists', 'DUPLICATE');
      const c = { id: uuid(), workspaceId: wid, userId: me(), name, description: body.description ?? '', createdAt: iso(), updatedAt: iso() };
      L.collections.push(c);
      return ok(c, 201);
    }
    if (a === 'collections' && id) {
      const c = L.collections.find((x) => x.id === id && x.workspaceId === wid && x.userId === me());
      if (!c) return problem(404, 'Collection not found');
      if (!sub && method === 'PATCH') return Object.assign(c, body.name ? { name: body.name.trim() } : {}), ok(c);
      if (!sub && method === 'DELETE') {
        L.collections = L.collections.filter((x) => x !== c);
        L.links = L.links.filter((l) => l.collectionId !== c.id);
        return noContent();
      }
      if (sub === 'items' && method === 'POST') {
        if (!own(wid, body?.itemId)) return problem(404, 'Not found');
        if (!L.links.some((l) => l.collectionId === c.id && l.itemId === body.itemId)) L.links.push({ collectionId: c.id, itemId: body.itemId });
        return noContent();
      }
      if (sub === 'items' && subId && method === 'DELETE') return (L.links = L.links.filter((l) => !(l.collectionId === c.id && l.itemId === subId))), noContent();
    }

    if (a === 'stats' && method === 'GET') return ok(stats(wid));
    if (a === 'metadata' && id === 'search' && method === 'GET') {
      if (!opts.metadata) return ok({ enabled: false, providers: [], results: [] });
      const q = query.get('q') ?? '';
      return ok({
        enabled: true,
        providers: ['OPEN_LIBRARY'],
        results: q.trim().length < 2 ? [] : [
              {
                provider: 'OPEN_LIBRARY',
                title: `${q} (DEMO result)`,
                subtitle: null,
                authors: ['Demo Author'],
                publisher: 'Demo Press',
                publishedYear: 2020,
                isbn13: '9780000000019',
                pageCount: 240,
                subjects: [],
                description: null,
                coverUrl: null,
                language: 'en',
                externalIds: { openLibrary: 'OL0000001M' },
              },
            ],
      });
    }
    return problem(404, 'Not found');
  }

  return { library: L, handle, seed, chapters: CHAPTERS, addBook, addItem };
}
