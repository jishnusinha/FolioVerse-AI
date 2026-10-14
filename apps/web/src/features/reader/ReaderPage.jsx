import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiBytes } from '@/api/client.js';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { HIGHLIGHT_COLORS, libraryApi, libraryKeys, useAnnotations, useBookmarks, useLibraryItem } from '@/features/library/queries.js';
import { CitedText } from '@/features/runs/CitedText.jsx';
import { useRunEvents } from '@/features/runs/useRunEvents.js';
import { visibleText } from '@/features/runs/runState.js';
import { Icon } from '@/shared/icons.jsx';
import { FolioLens } from '@/shared/overlays/FolioLens.jsx';
import { Button, Callout, DemoBadge, Empty, Skeleton, StatusBadge, Textarea, toast } from '@/shared/ui/index.js';
import { ReaderEngine } from './ReaderEngine.jsx';
import { chapterFor, locatorLabel, pageForLocator, percentOf } from './locator.js';

const PREFS_KEY = 'fv-reader-prefs';
const DEFAULT_PREFS = { fontSize: 18, theme: 'paper', width: '62ch', font: 'serif' };
const SAVE_MS = 1500;
const MODE_TITLE = { define: 'Definitions', explain: 'Explanation', summarize: 'Summary', ask: 'Answer', context: 'Background' };
/** Reader Lens actions. AI actions call `passage_explain`, bounded at the end of the selection. */
const AI_ACTIONS = [
  ['define', 'Define'],
  ['explain', 'Explain'],
  ['summarize', 'Summarize passage'],
];
const NOTE_ACTIONS = [
  ['hl', 'Highlight'],
  ['note', 'Add note'],
];

function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;

function Settings({ prefs, setPrefs }) {
  const seg = (key, label, options) => (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={prefs[key] === v} onClick={() => setPrefs((p) => ({ ...p, [key]: v }))}>
          {l}
        </button>
      ))}
    </div>
  );
  return (
    <div className="rset" role="group" aria-label="Reader settings">
      <label className="row">
        Size
        <input type="range" min={15} max={24} value={prefs.fontSize} aria-label="Text size" onChange={(e) => setPrefs((p) => ({ ...p, fontSize: Number(e.target.value) }))} />
        <span className="mono">{prefs.fontSize}px</span>
      </label>
      {seg('theme', 'Theme', [
        ['paper', 'Paper'],
        ['sepia', 'Sepia'],
        ['night', 'Night'],
      ])}
      {seg('width', 'Line width', [
        ['54ch', 'Narrow'],
        ['62ch', 'Comfortable'],
        ['74ch', 'Wide'],
      ])}
      {seg('font', 'Typeface', [
        ['serif', 'Serif'],
        ['sans', 'Sans'],
      ])}
    </div>
  );
}

function ExplainPanel({ wid, run, onCite, onClose }) {
  const state = useRunEvents(wid, run.runId);
  const text = visibleText(state);
  const guard = state.retrieval?.spoilerGuard;
  return (
    <section className="ai-block" aria-label={`${MODE_TITLE[run.mode]} of the selected passage`} aria-live="polite">
      <div className="row between">
        <span className="ai-tag">◆ {MODE_TITLE[run.mode]}</span>
        <div className="row">
          {run.isDemo && <DemoBadge />}
          <StatusBadge family="run" value={state.status} />
          <button type="button" className="icon-btn" aria-label="Close explanation" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>
      {run.question && <p className="subtle" style={{ margin: '6px 0 0' }}>Q: {run.question}</p>}
      <blockquote className="quote" style={{ margin: '8px 0', fontSize: 13 }}>
        “{run.passage.length > 160 ? `${run.passage.slice(0, 159)}…` : run.passage}”
      </blockquote>
      {state.status === 'BUDGET_REJECTED' || state.error ? (
        <Callout tone="bad">{state.error?.message ?? 'The budget limit was reached before any model call. Nothing was charged.'}</Callout>
      ) : text ? (
        <div style={{ lineHeight: 1.6 }}>
          <CitedText text={text} citations={state.citations} onCite={(m) => onCite(state.citations[m])} />
        </div>
      ) : (
        <div className="stack" style={{ gap: 6 }} aria-busy="true">
          <Skeleton width="90%" />
          <Skeleton width="70%" />
        </div>
      )}
      <p className="callout" style={{ fontSize: 12, marginTop: 8 }}>
        Context sent: {run.chapterTitle ?? `chapter ${run.page}`} up to the end of your selection
        {guard ? `, ${guard.summaries} earlier chapter summar${guard.summaries === 1 ? 'y' : 'ies'} and ${typeof guard.earlier === 'number' ? guard.earlier : 0} earlier passage${guard.earlier === 1 ? '' : 's'}` : ''}. Later
        chapters are never sent.
      </p>
      {state.done && (
        <Link className="subtle" style={{ fontSize: 12 }} to={`/app/studio/runs/${run.runId}`}>
          Open run in Studio
        </Link>
      )}
    </section>
  );
}

export function ReaderPage() {
  const { itemId } = useParams();
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const editor = can(ws, 'EDITOR');
  const qc = useQueryClient();
  const item = useLibraryItem(wid, itemId);
  const source = item.data?.source;
  const kind = source?.mimeType === 'application/pdf' ? 'pdf' : 'epub';
  const readable = source && ['READY', 'PARTIAL'].includes(source.ingestionState);
  const file = useQuery({
    queryKey: ['book-file', wid, source?.currentVersionId],
    queryFn: () => apiBytes(libraryApi.fileUrl(wid, source)),
    enabled: Boolean(wid && readable),
    staleTime: Infinity,
    retry: false,
  });
  const annotations = useAnnotations(wid, itemId);
  const bookmarks = useBookmarks(wid, itemId);
  const engine = useRef(null);

  const [prefs, setPrefs] = useState(loadPrefs);
  const [showSettings, setShowSettings] = useState(false);
  const [toc, setToc] = useState([]);
  const [loc, setLoc] = useState(null);
  const [sel, setSel] = useState(null);
  const [run, setRun] = useState(null);
  const [noteDraft, setNoteDraft] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const save = useRef({ timer: null, last: Date.now(), pending: null });

  useEffect(() => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)), [prefs]);
  const chapters = useMemo(() => item.data?.chapters ?? [], [item.data]);
  const [params] = useSearchParams();
  const initial = useMemo(() => {
    if (params.get('cfi')) return { locations: { cfi: params.get('cfi') } };
    const page = Number(params.get('page'));
    if (page > 0) return { href: item.data?.chapters?.find((c) => c.page === page)?.href, locations: { page } };
    return item.data?.progress?.locator ?? null;
  }, [item.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = useCallback(() => {
    const s = save.current;
    clearTimeout(s.timer);
    if (!s.pending || !wid) return;
    const now = Date.now();
    const secondsDelta = Math.min(3600, Math.round((now - s.last) / 1000));
    const locator = s.pending;
    s.pending = null;
    s.last = now;
    libraryApi
      .saveProgress(wid, itemId, { locator, percent: Math.min(1, Math.max(0, locator.locations?.totalProgression ?? 0)), secondsDelta })
      .catch(() => undefined);
  }, [wid, itemId]);
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      flush();
      qc.invalidateQueries({ queryKey: libraryKeys.allItems(wid) });
    };
  }, [flush, qc, wid]);

  const onRelocate = useCallback(
    (l) => {
      setLoc(l);
      save.current.pending = l;
      clearTimeout(save.current.timer);
      save.current.timer = setTimeout(flush, SAVE_MS);
    },
    [flush],
  );

  const highlights = useMemo(
    () => annotations.annotations.map((a) => ({ id: a.id, color: a.color, locator: a.locator, kind: a.kind })),
    [annotations.annotations],
  );
  const goTo = (target) => engine.current?.goTo(target);
  const current = chapterFor(chapters, loc);
  const currentLabel = locatorLabel(chapters, loc) || (kind === 'pdf' ? '' : 'Opening…');
  const nav = chapters.length ? chapters.map((c) => ({ key: c.href, label: c.title || `Chapter ${c.page}`, page: c.page, target: c.href })) : toc.map((t) => ({ key: t.href, label: t.label, page: t.page, target: t.page ?? t.href }));
  const currentPage = kind === 'pdf' ? loc?.locations?.page : current?.page;
  const marked = bookmarks.data?.find((b) => (kind === 'pdf' ? b.locator?.locations?.page === loc?.locations?.page : pageForLocator(chapters, b.locator) === currentPage));

  async function addAnnotation(kindOf, s, note) {
    const id = newId();
    const body = { id, kind: kindOf, color: 'amber', locator: s.locator, quote: s.text.slice(0, 4000), ...(note ? { note } : {}) };
    const at = new Date().toISOString();
    annotations.setLocal((list) => [...list, { ...body, createdAt: at, updatedAt: at }]);
    try {
      await libraryApi.createAnnotation(wid, itemId, body);
      annotations.sync();
    } catch (e) {
      annotations.setLocal((list) => list.filter((a) => a.id !== id));
      toast(`Not saved: ${e.message}`, 'bad');
    }
  }

  async function explain(mode, s, question) {
    try {
      const res = await libraryApi.explain(wid, itemId, { mode, passage: s.text.slice(0, 4000), locator: s.locator, ...(question ? { question } : {}) });
      setRun({ runId: res.runId, mode, passage: s.text, question, page: res.page, chapterTitle: res.chapterTitle, isDemo: res.model?.provider === 'mock' });
    } catch (e) {
      toast(e.code === 'LOCATOR_UNKNOWN' ? 'This passage could not be placed in the book, so nothing was sent.' : e.message, 'bad');
    }
  }

  async function onLensAction(id) {
    const s = sel;
    setSel(null);
    s?.clear?.();
    if (!s) return;
    if (id === 'hl') return addAnnotation('HIGHLIGHT', s);
    if (id === 'note') return setNoteDraft({ selection: s, text: '' });
    if (id === 'excerpt') {
      try {
        await libraryApi.excerpt(wid, itemId, { quote: s.text.slice(0, 4000), locator: s.locator });
        toast('Saved as an excerpt. Add it to a manuscript from Writer → Research.', 'ok');
      } catch (e) {
        toast(e.message, 'bad');
      }
      return;
    }
    return explain(id, s);
  }

  async function toggleBookmark() {
    if (!loc) return;
    try {
      if (marked) await libraryApi.removeBookmark(wid, itemId, marked.id);
      else await libraryApi.createBookmark(wid, itemId, { locator: loc, label: currentLabel });
      await qc.invalidateQueries({ queryKey: libraryKeys.bookmarks(wid, itemId) });
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  async function removeAnnotation(a) {
    annotations.setLocal((list) => list.filter((x) => x.id !== a.id));
    try {
      await libraryApi.removeAnnotation(wid, itemId, a.id);
    } finally {
      annotations.sync();
    }
  }

  async function recolor(a, color) {
    annotations.setLocal((list) => list.map((x) => (x.id === a.id ? { ...x, color } : x)));
    await libraryApi.updateAnnotation(wid, itemId, a.id, { color }).catch((e) => toast(e.message, 'bad'));
    annotations.sync();
  }

  function onCite(c) {
    const l = c?.anchor?.locator;
    if (l?.cfi) return goTo(l.cfi);
    const ch = chapters.find((x) => x.page === c?.anchor?.page);
    if (ch) goTo(ch.href);
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
      if (e.key === 'ArrowRight') engine.current?.next();
      if (e.key === 'ArrowLeft') engine.current?.prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (item.isPending) return <Skeleton height={400} />;
  if (item.error)
    return (
      <div className="page">
        <h1>Book not found</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          It is not on your shelf. Library books are private to the reader who added them.
        </p>
        <Link className="btn" style={{ marginTop: 14 }} to="/app/library">
          Back to Library
        </Link>
      </div>
    );
  const book = item.data.book;
  const lensActions = [...(editor ? AI_ACTIONS : []), ...NOTE_ACTIONS, ...(editor ? [['excerpt', 'Save as excerpt']] : [])];
  const notes = annotations.annotations;

  return (
    <div className="panes r-panes">
      <aside className="ctx" aria-label="Contents">
        <p className="eyebrow" style={{ padding: '4px 8px' }}>
          {book.title}
        </p>
        <ul className="tree" aria-label="Table of contents">
          {nav.map((c, i) => (
            <li key={c.key}>
              <button type="button" className="tnode" aria-current={c.page != null && c.page === currentPage} onClick={() => goTo(c.target)}>
                <span className="mono">{i + 1}</span>
                <span className="grow">{c.label}</span>
                {currentPage && c.page < currentPage && <span aria-label="read">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="pane" aria-label="Reader">
        <div className="bar-top no-print">
          <Link className="icon-btn" to="/app/library" aria-label="Back to Library">
            <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
              <Icon name="chev" size={16} />
            </span>
          </Link>
          <h1 style={{ fontSize: 'var(--fv-fs-md)', margin: 0 }}>{book.title}</h1>
          <span className="subtle" aria-live="polite">
            {currentLabel}
            {loc ? ` · ${percentOf(loc)}%` : ''}
          </span>
          <span className="grow" />
          <Button size="sm" onClick={() => engine.current?.prev()} aria-label="Previous">
            ‹
          </Button>
          <Button size="sm" onClick={() => engine.current?.next()} aria-label="Next">
            ›
          </Button>
          <Button size="sm" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
            Aa Reader settings
          </Button>
          <Button size="sm" onClick={toggleBookmark} aria-pressed={Boolean(marked)} disabled={!loc}>
            <Icon name="bookmark" size={14} />
            {marked ? 'Bookmarked' : 'Bookmark'}
          </Button>
        </div>
        {showSettings && <Settings prefs={prefs} setPrefs={setPrefs} />}
        <div className="reader" data-rt={prefs.theme} style={{ '--r-fs': `${prefs.fontSize}px`, '--r-w': prefs.width }}>
          {!source ? (
            <Empty>This book has no file. Upload its EPUB or PDF to read it here.</Empty>
          ) : !readable ? (
            <div className="text">
              <p>
                The file is being prepared: <StatusBadge family="ingest" value={source.ingestionState} />
              </p>
            </div>
          ) : file.error ? (
            <Callout tone="bad">The book file could not be loaded: {file.error.message}</Callout>
          ) : !file.data ? (
            <Skeleton height={420} />
          ) : (
            <ReaderEngine
              ref={engine}
              kind={kind}
              data={file.data}
              initial={initial}
              prefs={prefs}
              highlights={highlights}
              onReady={({ toc: t }) => setToc(t)}
              onRelocate={onRelocate}
              onSelect={setSel}
              onHighlightClick={setFocusId}
            />
          )}
        </div>
        <FolioLens open={Boolean(sel)} kind="R" text={sel?.text ?? ''} anchor={sel?.rect ?? null} actions={lensActions} onClose={() => setSel(null)} onAction={onLensAction} onAsk={editor ? (q) => (setSel(null), explain('ask', sel, q)) : undefined} />
      </section>

      <aside className="side" aria-label="Notes and AI">
        <div className="pad stack" style={{ gap: 16 }}>
          {run ? (
            <ExplainPanel wid={wid} run={run} onCite={onCite} onClose={() => setRun(null)} />
          ) : (
            <p className="callout ai">
              Select a passage to {editor ? 'define, explain or summarize it, or to ' : ''}highlight it or add a note. Explanations only see the book up to your selection.
            </p>
          )}
          {noteDraft && (
            <form
              className="stack"
              style={{ gap: 8 }}
              aria-label="New note"
              onSubmit={(e) => {
                e.preventDefault();
                if (!noteDraft.text.trim()) return;
                addAnnotation('NOTE', noteDraft.selection, noteDraft.text.trim());
                setNoteDraft(null);
              }}
            >
              <blockquote className="quote" style={{ margin: 0, fontSize: 13 }}>
                “{noteDraft.selection.text.slice(0, 200)}”
              </blockquote>
              <Textarea aria-label="Note text" rows={3} value={noteDraft.text} onChange={(e) => setNoteDraft((d) => ({ ...d, text: e.target.value }))} autoFocus />
              <div className="row">
                <Button size="sm" variant="primary" type="submit">
                  Save note
                </Button>
                <Button size="sm" onClick={() => setNoteDraft(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          <section aria-labelledby="r-notes">
            <h3 className="sect-h" id="r-notes">
              Highlights &amp; notes ({notes.length})
            </h3>
            {notes.length === 0 ? (
              <p className="subtle">Nothing yet. Select text and choose Highlight or Add note.</p>
            ) : (
              <ul className="list" aria-label="Highlights and notes">
                {notes.map((a) => (
                  <li key={a.id} className="li" data-focus={focusId === a.id || undefined} style={{ alignItems: 'flex-start' }}>
                    <span aria-hidden="true" style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: `var(--fv-hl-${a.color})` }} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <button type="button" className="linkish" style={{ textAlign: 'left' }} onClick={() => goTo(a.locator)}>
                        “{a.quote.length > 140 ? `${a.quote.slice(0, 139)}…` : a.quote}”
                      </button>
                      {a.note && <p style={{ fontSize: 13, marginTop: 4 }}>✎ {a.note}</p>}
                      <p className="subtle" style={{ fontSize: 12 }}>
                        {locatorLabel(chapters, a.locator)}
                      </p>
                      <div className="row" role="group" aria-label="Highlight colour" style={{ gap: 4, marginTop: 4 }}>
                        {HIGHLIGHT_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-label={c}
                            aria-pressed={a.color === c}
                            onClick={() => recolor(a, c)}
                            style={{ width: 24, height: 24, borderRadius: 99, border: a.color === c ? '2px solid var(--fv-text)' : '1px solid var(--fv-border-strong)', background: `var(--fv-hl-${c})`, cursor: 'pointer' }}
                          />
                        ))}
                      </div>
                    </div>
                    <button type="button" className="icon-btn" aria-label={`Delete ${a.kind === 'NOTE' ? 'note' : 'highlight'}`} onClick={() => removeAnnotation(a)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="r-bm">
            <h3 className="sect-h" id="r-bm">
              Bookmarks ({bookmarks.data?.length ?? 0})
            </h3>
            {bookmarks.data?.length ? (
              <ul className="list" aria-label="Bookmarks">
                {bookmarks.data.map((b) => (
                  <li key={b.id} className="li">
                    <Icon name="bookmark" size={14} />
                    <button type="button" className="linkish grow" style={{ textAlign: 'left' }} onClick={() => goTo(b.locator)}>
                      {b.label || locatorLabel(chapters, b.locator) || 'Bookmark'}
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove bookmark ${b.label}`}
                      onClick={() => libraryApi.removeBookmark(wid, itemId, b.id).then(() => qc.invalidateQueries({ queryKey: libraryKeys.bookmarks(wid, itemId) }))}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="subtle">No bookmarks yet.</p>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
